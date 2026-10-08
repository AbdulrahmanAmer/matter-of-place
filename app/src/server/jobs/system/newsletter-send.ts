import { z } from "zod";
import {
  Conflict,
  createBroadcast,
  ensureAudience,
  getBroadcast,
  RateLimited,
  sendBroadcast,
} from "../../channels/resend.ts";
import { loadSiteContext, readSettings, siteOf } from "../../email/context.ts";
import type { RenderedEmail } from "../../email/render.ts";
import type { Db } from "../../lib/db.ts";
import { enqueueJob } from "../../lib/jobs.ts";
import { readVar } from "../../lib/runtime-env.ts";
import { syncAudience } from "../../newsletter/audience.ts";
import { loadBlocks, readIssue, renderIssue, type StoredIssue } from "../../newsletter/issue.ts";
import { assertQuota } from "../../newsletter/quota.ts";
import { UNSUBSCRIBE_URL } from "../../../templates/email/blocks/footer.tsx";
import type { StepContext, StepResult, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// System job `newsletter_send` (B11 invariants 4 to 6), enqueued by `newsletter_approve_issue` with the key
// `newsletter_send:<issue_id>:<approval_count>`. The broadcast is created at most once (its id is stored right after
// create and checked first) and sent at most once (INT-10): a stored id Resend no longer holds as a draft means the send
// was accepted, so the issue is marked sent with no second send.

const AUDIENCE = "place-notes";
const NOTIFY_ATTEMPTS = 12;

const input = z.object({ issue_id: z.string().uuid(), approval_count: z.number().int() });

const done = (result: Record<string, string | number | boolean>): StepResult => ({
  status: "done",
  result,
});

async function rpcOrThrow(
  pending: PromiseLike<{ error: { code: string } | null }>,
  name: string,
): Promise<void> {
  const { error } = await pending;
  if (error !== null) throw new Error(`newsletter_write_failed:${name}:${error.code}`);
}

const setSendError = (db: Db, issueId: string, reason: string) =>
  rpcOrThrow(
    db.rpc("newsletter_set_send_error", { p_issue: issueId, p_error: reason }),
    "newsletter_set_send_error",
  );

/** The G13 notice: a headline, a summary and the screen that fixes it, once per key. */
async function notifyAdmin(
  db: Db,
  key: string,
  notice: { headline: string; summary: string; link: string },
): Promise<void> {
  await enqueueJob(db, {
    type: "notify_admin",
    idempotencyKey: `notify_admin:${key}`,
    params: { headline: notice.headline },
    data: { summary: notice.summary, link_path: notice.link },
    maxAttempts: NOTIFY_ATTEMPTS,
  });
}

async function channelEnabled(db: Db): Promise<boolean> {
  const { data, error } = await db
    .from("channel_settings")
    .select("enabled")
    .eq("channel", "newsletter")
    .limit(1);
  if (error !== null) throw new Error("newsletter_read_failed:channel_settings");
  return data[0]?.enabled === true;
}

async function recipientCount(db: Db): Promise<number> {
  const { data, error } = await db.rpc("newsletter_recipient_count", { p_audience: AUDIENCE });
  if (error !== null) throw new Error("newsletter_read_failed:newsletter_recipient_count");
  return data;
}

async function markSending(db: Db, issue: StoredIssue): Promise<boolean> {
  const { data, error } = await db.rpc("newsletter_mark_sending", {
    p_issue: issue.id,
    p_approval_count: issue.approval_count,
  });
  if (error !== null) throw new Error("newsletter_write_failed:newsletter_mark_sending");
  return data;
}

const markSent = (db: Db, issueId: string, recipients: number) =>
  rpcOrThrow(
    db.rpc("newsletter_mark_sent", { p_issue: issueId, p_recipients: recipients }),
    "newsletter_mark_sent",
  );

/** Resend already holds the send: the issue ends `sent` with the audience's count, and nothing is sent again. */
async function adopt(db: Db, issue: StoredIssue): Promise<StepResult> {
  if (!(await markSending(db, issue))) return done({ skipped: "stale" });
  await markSent(db, issue.id, await recipientCount(db));
  return done({ adopted: true });
}

const accepted = async (id: string): Promise<boolean> =>
  (await getBroadcast(id)).status !== "draft";

/** The quota gate of invariant 5: `null` to go on, else what the job does now. */
async function quotaGate(
  ctx: StepContext,
  issue: StoredIssue,
  recipients: number,
): Promise<StepResult | null> {
  const quota = await assertQuota(ctx.db, recipients, ctx.now);
  const name = `Place Notes No. ${String(issue.number)}`;
  const link = `/admin/newsletter/${issue.id}`;
  if (quota.status === "ok") return null;
  if (quota.status === "exceeds_plan") {
    await notifyAdmin(ctx.db, `quota_plan:${issue.id}:${String(issue.approval_count)}`, {
      headline: `${name} exceeds the free sending plan`,
      summary: `${String(quota.recipients)} recipients, bulk cap ${String(quota.bulkCap)}; sending needs a paid plan decision`,
      link,
    });
    throw new NonRetryableError("quota_exceeds_plan");
  }
  await notifyAdmin(ctx.db, `quota:${issue.id}:${ctx.now.toISOString().slice(0, 10)}`, {
    headline: `${name} waits for tomorrow's quota`,
    summary: `${String(quota.recipients)} recipients, ${String(quota.sentToday)} sent today, bulk cap ${String(quota.bulkCap)}`,
    link,
  });
  return { status: "retry_at", at: quota.at, reason: "quota" };
}

/** Creates the broadcast unless its id is stored, stores the id at once, then sends it. */
async function broadcast(
  ctx: StepContext,
  issue: StoredIssue,
  email: RenderedEmail,
  recipients: number,
): Promise<StepResult> {
  const { db } = ctx;
  const from = readVar("RESEND_FROM_BULK");
  if (from === undefined || from === "") throw new NonRetryableError("resend_not_configured");
  const replyTo =
    siteOf(await readSettings(db, ["site"])).contact.email ?? readVar("ADMIN_NOTIFY_EMAIL");
  if (replyTo === undefined || replyTo === "") throw new NonRetryableError("recipient_missing");
  let id = issue.resend_broadcast_id;
  if (id === null) {
    id = await createBroadcast({
      audienceId: await ensureAudience(db, AUDIENCE),
      from,
      replyTo,
      ...email,
      headers: {
        "List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await rpcOrThrow(
      db.rpc("newsletter_set_broadcast_id", { p_issue: issue.id, p_broadcast_id: id }),
      "newsletter_set_broadcast_id",
    );
  }
  try {
    await sendBroadcast(id);
  } catch (error) {
    if (error instanceof Conflict && (await accepted(id))) return adopt(db, issue);
    throw error;
  }
  await markSent(db, issue.id, recipients);
  return done({ broadcast_id: id, recipients });
}

/** Everything that talks to Resend: a 429 waits, a refusal no retry fixes is written to `send_error`. */
async function deliver(
  ctx: StepContext,
  issue: StoredIssue,
  email: RenderedEmail,
): Promise<StepResult> {
  try {
    if (issue.resend_broadcast_id !== null && (await accepted(issue.resend_broadcast_id))) {
      return await adopt(ctx.db, issue);
    }
    const recipients = await recipientCount(ctx.db);
    const gate = await quotaGate(ctx, issue, recipients);
    if (gate !== null) return gate;
    await syncAudience(ctx.db, AUDIENCE);
    if (!(await markSending(ctx.db, issue))) return done({ skipped: "stale" });
    return await broadcast(ctx, issue, email, recipients);
  } catch (error) {
    if (error instanceof RateLimited) {
      return { status: "retry_at", at: error.retryAt, reason: error.message };
    }
    if (error instanceof NonRetryableError) await setSendError(ctx.db, issue.id, error.message);
    throw error;
  }
}

async function run(ctx: StepContext, data: Record<string, unknown>): Promise<StepResult> {
  const parsed = input.safeParse(data);
  if (!parsed.success) throw new NonRetryableError("issue_id_missing");
  const { db } = ctx;
  const issue = await readIssue(db, parsed.data.issue_id);
  if (
    issue === null ||
    (issue.status !== "approved" && issue.status !== "sending") ||
    issue.approval_count !== parsed.data.approval_count
  ) {
    return done({ skipped: "stale" });
  }
  const name = `Place Notes No. ${String(issue.number)}`;
  const once = `${issue.id}:${String(issue.approval_count)}`;
  if (!(await channelEnabled(db))) {
    await notifyAdmin(db, `newsletter_disabled:${once}`, {
      headline: `${name} not sent: the newsletter channel is off`,
      summary: "Switch the newsletter channel on, then approve the issue again",
      link: "/admin/automation/settings",
    });
    return done({ skipped: "channel_disabled" });
  }
  const loaded = await loadBlocks(db, issue);
  if (loaded.unpublished.length > 0) {
    await setSendError(
      db,
      issue.id,
      `block_unpublished:${loaded.unpublished.map((block) => block.id).join(",")}`,
    );
    await notifyAdmin(db, `block_unpublished:${once}`, {
      headline: `${name} holds an unpublished item`,
      summary: loaded.unpublished.map((block) => block.title).join("; "),
      link: `/admin/newsletter/${issue.id}`,
    });
    throw new NonRetryableError("block_unpublished");
  }
  const site = await loadSiteContext(db);
  const email = await renderIssue(loaded.render, site);
  if (site.entity === null || site.address === null || !email.html.includes(UNSUBSCRIBE_URL)) {
    await setSendError(db, issue.id, "footer_incomplete");
    throw new NonRetryableError("footer_incomplete");
  }
  return deliver(ctx, issue, email);
}

export const newsletterSend: SystemJobDefinition = {
  type: "newsletter_send",
  sideEffect: "remote_lookup",
  maxAttempts: 12,
  run: (ctx, _params, data) => run(ctx, data),
};
