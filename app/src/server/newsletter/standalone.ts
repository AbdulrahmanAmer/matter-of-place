import { z } from "zod";
import { UNSUBSCRIBE_URL } from "../../templates/email/blocks/footer.tsx";
import { footerLines } from "../../templates/email/layout.tsx";
import {
  Conflict,
  createBroadcast,
  ensureAudience,
  getBroadcast,
  RateLimited,
  sendBroadcast,
} from "../channels/resend.ts";
import { loadSiteContext, type SiteContext } from "../email/context.ts";
import { renderTemplate, type RenderedEmail } from "../email/render.ts";
import { templateRow } from "../jobs/steps/send-email.ts";
import {
  NonRetryableError,
  type JsonObject,
  type StepContext,
  type StepResult,
} from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { readVar } from "../lib/runtime-env.ts";
import { MARKET_AUDIENCE, syncAudience, type AudienceKey } from "./audience.ts";
import { assertQuota } from "./quota.ts";
import { withUtm } from "./render.ts";

// `sendStandalone` (B11 invariant 9): the Campaign email of one property, sent as one Broadcast to the confirmed
// Place Notes subscribers of its market. `send_email` delegates here when `params.template = "standalone"` and the job
// is not a test. The broadcast is created at most once (its id is written to `assets.meta.broadcast` right after
// create) and sent at most once (INT-10): a stored id Resend no longer holds as a draft means the send was accepted.

const WAIT_MS = 3_600_000;
const MAX_AGE_MS = 7 * 86_400_000;
const NOTIFY_ATTEMPTS = 12;
const ASSETS_LINK = "/admin/assets";

const done = (result: Record<string, string | number | boolean>): StepResult => ({
  status: "done",
  result,
});

const sentMeta = z.object({
  broadcast: z
    .object({
      id: z.string(),
      recipients: z.number().int().optional(),
      sent_at: z.string().optional(),
    })
    .optional(),
});

const contentMeta = z.object({
  subject: z.string().min(1),
  preheader: z.string(),
  block: z.object({ title: z.string().min(1), deck: z.string(), link: z.string() }).passthrough(),
});

interface Target {
  assetId: string;
  revision: number;
  broadcastId: string | undefined;
  title: string;
  audience: AudienceKey;
}

function audienceOf(market: string): AudienceKey {
  for (const [slug, key] of Object.entries(MARKET_AUDIENCE)) if (slug === market) return key;
  throw new NonRetryableError("market_unknown");
}

async function readProperty(db: Db, id: string) {
  const { data, error } = await db
    .from("properties")
    .select("id, slug, title, market_slug, editorial_state, taken_down_at")
    .eq("id", id)
    .limit(1);
  if (error !== null) throw new Error("standalone_read_failed:properties");
  return data[0];
}

async function readAsset(db: Db, propertyId: string) {
  const { data, error } = await db
    .from("assets")
    .select("id, revision, status, meta")
    .eq("property_id", propertyId)
    .eq("kind", "standalone_email")
    .order("revision", { ascending: false })
    .limit(1);
  if (error !== null) throw new Error("standalone_read_failed:assets");
  return data[0];
}

/** The job's age: a standalone send that waited a week for its approval is given up. */
async function jobIsStale(ctx: StepContext): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("jobs")
    .select("created_at")
    .eq("id", ctx.job.id)
    .limit(1);
  const created = data?.[0]?.created_at;
  if (error !== null || created === undefined) throw new Error("standalone_read_failed:jobs");
  return ctx.now.getTime() - Date.parse(created) > MAX_AGE_MS;
}

async function channelEnabled(db: Db): Promise<boolean> {
  const { data, error } = await db
    .from("channel_settings")
    .select("enabled")
    .eq("channel", "newsletter")
    .limit(1);
  if (error !== null) throw new Error("standalone_read_failed:channel_settings");
  return data[0]?.enabled === true;
}

async function recipientCount(db: Db, audience: AudienceKey): Promise<number> {
  const { data, error } = await db.rpc("newsletter_recipient_count", { p_audience: audience });
  if (error !== null) throw new Error("standalone_read_failed:newsletter_recipient_count");
  return data;
}

/** `meta.broadcast` is replaced whole by `set_asset_text`, so every write carries the full object. */
async function writeBroadcast(
  db: Db,
  assetId: string,
  broadcast: { id: string; recipients?: number; sent_at?: string },
): Promise<void> {
  const { error } = await db.rpc("set_asset_text", { p_asset: assetId, p_meta: { broadcast } });
  if (error !== null) throw new Error("standalone_write_failed:set_asset_text");
}

async function notifyAdmin(
  db: Db,
  key: string,
  notice: { headline: string; summary: string },
): Promise<void> {
  await enqueueJob(db, {
    type: "notify_admin",
    idempotencyKey: `notify_admin:${key}`,
    params: { headline: notice.headline },
    data: { summary: notice.summary, link_path: ASSETS_LINK },
    maxAttempts: NOTIFY_ATTEMPTS,
  });
}

/** Resend already holds the send: the asset records the audience's count and the time, and nothing is sent again. */
async function adopt(ctx: StepContext, target: Target, id: string): Promise<StepResult> {
  const recipients = await recipientCount(ctx.db, target.audience);
  await writeBroadcast(ctx.db, target.assetId, { id, recipients, sent_at: ctx.now.toISOString() });
  return done({ adopted: true });
}

const accepted = async (id: string): Promise<boolean> =>
  (await getBroadcast(id)).status !== "draft";

/** The quota gate of invariant 5: `null` to go on, else what the job does now. */
async function quotaGate(
  ctx: StepContext,
  target: Target,
  recipients: number,
): Promise<StepResult | null> {
  const quota = await assertQuota(ctx.db, recipients, ctx.now);
  if (quota.status === "ok") return null;
  const name = `Standalone email for ${target.title}`;
  if (quota.status === "exceeds_plan") {
    await notifyAdmin(
      ctx.db,
      `quota_plan:standalone:${target.assetId}:${String(target.revision)}`,
      {
        headline: `${name} exceeds the free sending plan`,
        summary: `${String(quota.recipients)} recipients, bulk cap ${String(quota.bulkCap)}; sending needs a paid plan decision`,
      },
    );
    throw new NonRetryableError("quota_exceeds_plan");
  }
  await notifyAdmin(
    ctx.db,
    `quota:standalone:${target.assetId}:${ctx.now.toISOString().slice(0, 10)}`,
    {
      headline: `${name} waits for tomorrow's quota`,
      summary: `${String(quota.recipients)} recipients, ${String(quota.sentToday)} sent today, bulk cap ${String(quota.bulkCap)}`,
    },
  );
  return { status: "retry_at", at: quota.at, reason: "quota" };
}

/** Creates the broadcast unless its id is stored, stores the id at once, then sends it. */
async function broadcast(
  ctx: StepContext,
  target: Target,
  email: RenderedEmail,
  recipients: number,
  replyTo: string | null,
): Promise<StepResult> {
  const { db } = ctx;
  const from = readVar("RESEND_FROM_BULK");
  if (from === undefined || from === "") throw new NonRetryableError("resend_not_configured");
  const reply = replyTo ?? readVar("ADMIN_NOTIFY_EMAIL");
  if (reply === undefined || reply === "") throw new NonRetryableError("recipient_missing");
  let id = target.broadcastId;
  if (id === undefined) {
    id = await createBroadcast({
      audienceId: await ensureAudience(db, target.audience),
      from,
      replyTo: reply,
      ...email,
      headers: {
        "List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await writeBroadcast(db, target.assetId, { id });
  }
  try {
    await sendBroadcast(id);
  } catch (error) {
    if (error instanceof Conflict && (await accepted(id))) return adopt(ctx, target, id);
    throw error;
  }
  await writeBroadcast(db, target.assetId, { id, recipients, sent_at: ctx.now.toISOString() });
  return done({ broadcast_id: id, recipients });
}

/** Everything that talks to Resend: a 429 waits. */
async function deliver(
  ctx: StepContext,
  target: Target,
  email: RenderedEmail,
  replyTo: string | null,
): Promise<StepResult> {
  try {
    if (target.broadcastId !== undefined && (await accepted(target.broadcastId))) {
      return await adopt(ctx, target, target.broadcastId);
    }
    const recipients = await recipientCount(ctx.db, target.audience);
    const gate = await quotaGate(ctx, target, recipients);
    if (gate !== null) return gate;
    await syncAudience(ctx.db, target.audience);
    return await broadcast(ctx, target, email, recipients, replyTo);
  } catch (error) {
    if (error instanceof RateLimited) {
      return { status: "retry_at", at: error.retryAt, reason: error.message };
    }
    throw error;
  }
}

/** The plain-text part: the block's words and its link, then the footer lines and the unsubscribe address. */
export function standaloneText(
  block: { title: string; deck: string; link: string },
  site: SiteContext,
) {
  const parts = [block.title, block.deck, block.link, ...footerLines(site)];
  return `${[...parts.filter((part) => part !== ""), `Unsubscribe: ${UNSUBSCRIBE_URL}`].join("\n\n")}\n`;
}

/** Whether the approval of the asset lets the send go on now: `null` to go on, else what the job does. */
async function awaitApproval(ctx: StepContext, status: string): Promise<StepResult | null> {
  if (status === "rejected") throw new NonRetryableError("asset_not_approved");
  if (status !== "pending") return null;
  if (await jobIsStale(ctx)) throw new NonRetryableError("asset_not_approved");
  return {
    status: "retry_at",
    at: new Date(ctx.now.getTime() + WAIT_MS),
    reason: "asset_not_approved",
  };
}

export async function sendStandalone(ctx: StepContext, data: JsonObject): Promise<StepResult> {
  const { db } = ctx;
  const propertyId = data["property_id"];
  if (typeof propertyId !== "string") throw new NonRetryableError("property_id_missing");
  const property = await readProperty(db, propertyId);
  if (property === undefined) throw new NonRetryableError("property_not_found");
  if (property.editorial_state !== "published" || property.taken_down_at !== null) {
    return done({ skipped: "property_unpublished" });
  }
  const asset = await readAsset(db, propertyId);
  if (asset === undefined) throw new NonRetryableError("asset_not_approved");
  const stored = sentMeta.safeParse(asset.meta).data?.broadcast;
  if (stored?.sent_at !== undefined) return done({ skipped: "already_sent" });
  const waiting = await awaitApproval(ctx, asset.status);
  if (waiting !== null) return waiting;
  const content = contentMeta.safeParse(asset.meta);
  if (!content.success) throw new NonRetryableError("asset_incomplete");

  const site = await loadSiteContext(db);
  const link = withUtm(content.data.block.link, `standalone-${property.slug}`, property.slug);
  const block = { ...content.data.block, link };
  const variables = { subject: content.data.subject, preheader: content.data.preheader, block };
  const row = await templateRow(db, "standalone");
  const drawn = await renderTemplate(row, variables, site);
  if (site.entity === null || site.address === null || !drawn.html.includes(UNSUBSCRIBE_URL)) {
    throw new NonRetryableError("footer_incomplete");
  }
  if (!(await channelEnabled(db))) return done({ skipped: "channel_disabled" });
  const target: Target = {
    assetId: asset.id,
    revision: asset.revision,
    broadcastId: stored?.id,
    title: property.title,
    audience: audienceOf(property.market_slug),
  };
  return deliver(ctx, target, { ...drawn, text: standaloneText(block, site) }, site.contact.email);
}
