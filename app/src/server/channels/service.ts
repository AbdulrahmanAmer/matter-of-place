import { z } from "zod";
import {
  channelIdsSchema,
  socialPostSchema,
  type ChannelIdsKey,
  type SocialChannel,
  type SocialPost,
  type SocialPostFilters,
} from "../../domain/channels.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { adminJson } from "../lib/admin-response.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError, fromZod } from "../lib/errors.ts";
import { tokenHealth } from "./meta-token.ts";

// Screen 12 (B10 Files, `service.ts`). Each function authorizes before it touches the database (SEC-04), and no
// function here calls a platform (invariant 1): a write is one social.sql function that also writes its audit row.

const PAGE_SIZE = 50;
const AMBER_DAYS = 14;
const RED_DAYS = 7;
const X_READS_AMBER = 0.7;
const HEALTH_CHANNELS = ["instagram", "facebook", "x", "linkedin"] as const;

type Level = "ok" | "amber" | "red";

interface ChannelHealth {
  channel: SocialChannel;
  level: Level;
  label: string | null;
  lastPost: { at: string; permalink: string | null } | null;
  lastError: { at: string; error: string } | null;
  token: { expiresAt: string | null; daysLeft: number | null; level: Level };
  reads?: { used: number; allowance: number; level: Level };
}

const rank: Record<Level, number> = { ok: 0, amber: 1, red: 2 };
const worst = (...levels: Level[]): Level =>
  levels.reduce<Level>((a, b) => (rank[b] > rank[a] ? b : a), "ok");

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The database did not answer (${what}).`);

/** `GET /api/admin/channels/posts`: one page of 50, newest first, or the withdraw list oldest first (invariant 10). */
export async function listPosts(
  actor: AdminActor,
  db: Db,
  input: SocialPostFilters,
): Promise<{ items: SocialPost[]; total: number }> {
  authorize(actor, "channels.posts_list");
  let query = db.from("social_posts").select("*", { count: "exact" });
  if (input.post_id !== undefined) query = query.eq("id", input.post_id);
  if (input.channel !== undefined) query = query.eq("channel", input.channel);
  if (input.status !== undefined) query = query.eq("status", input.status);
  query =
    input.withdraw === true
      ? query
          .not("withdraw_required_at", "is", null)
          .is("withdrawn_at", null)
          .order("withdraw_required_at", { ascending: true })
      : query.order("created_at", { ascending: false });
  const from = (input.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error !== null) throw fromRpcError(error);
  return { items: z.array(socialPostSchema).parse(data), total: count ?? 0 };
}

const settingsSchema = z
  .object({
    token_state: z.string().optional(),
    token_expires_at: z.string().nullable().optional(),
    read_allowance: z.number().nullable().optional(),
    usage: z.object({ month: z.string(), reads: z.number() }).optional(),
  })
  .passthrough();

const daysUntil = (iso: string, now: Date) =>
  Math.floor((Date.parse(iso) - now.getTime()) / 86_400_000);

/** X and LinkedIn: the daily check's state, then the days left of the access token's expiry. */
function oauthTokenHealth(
  value: unknown,
  now: Date,
): ChannelHealth["token"] & { label: string | null } {
  const settings = settingsSchema.safeParse(value).data;
  const expiresAt = settings?.token_expires_at ?? null;
  const daysLeft = expiresAt === null ? null : daysUntil(expiresAt, now);
  if (settings?.token_state === "version_expired") {
    return { expiresAt, daysLeft, level: "amber", label: "API version expired" };
  }
  if (settings?.token_state !== "ok") return { expiresAt, daysLeft, level: "red", label: null };
  const level: Level =
    daysLeft === null
      ? "ok"
      : daysLeft <= RED_DAYS
        ? "red"
        : daysLeft <= AMBER_DAYS
          ? "amber"
          : "ok";
  return { expiresAt, daysLeft, level, label: null };
}

/** The month's X reads against the measured allowance (invariant 11), amber at 70 percent. */
function xReads(value: unknown, now: Date): NonNullable<ChannelHealth["reads"]> {
  const settings = settingsSchema.safeParse(value).data;
  const month = now.toISOString().slice(0, 7);
  const used = settings?.usage?.month === month ? settings.usage.reads : 0;
  const allowance = settings?.read_allowance ?? 0;
  return {
    used,
    allowance,
    level: allowance > 0 && used >= allowance * X_READS_AMBER ? "amber" : "ok",
  };
}

async function newest(
  db: Db,
  channel: SocialChannel,
  status: "posted" | "failed",
): Promise<{
  posted_at: string | null;
  permalink: string | null;
  error: string | null;
  updated_at: string;
} | null> {
  const { data, error } = await db
    .from("social_posts")
    .select("posted_at, permalink, error, updated_at")
    .eq("channel", channel)
    .eq("status", status)
    .order(status === "posted" ? "posted_at" : "updated_at", { ascending: false })
    .limit(1);
  if (error !== null) throw unavailable("social_posts");
  return data[0] ?? null;
}

/**
 * @public `GET /api/admin/channels/health` for screens 2 and 12: per channel the last post, the last error and the token's
 * state from `settings` (GS-01, INT-06). A dead token is red whatever its expiry, and so is a channel whose newest
 * failure is `token_dead` until a later post goes out. Reads `settings` and `social_posts` only.
 */
// STUB(B10 step 8): the health route and the screen 2 tile call it
export async function channelHealth(
  actor: AdminActor,
  db: Db,
  now: Date,
): Promise<ChannelHealth[]> {
  authorize(actor, "channels.health");
  const { data, error } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["meta", "x", "linkedin"]);
  if (error !== null) throw unavailable("settings");
  const settings = new Map(data.map((row) => [row.key, row.value]));
  return Promise.all(
    HEALTH_CHANNELS.map(async (channel): Promise<ChannelHealth> => {
      const [posted, failed] = await Promise.all([
        newest(db, channel, "posted"),
        newest(db, channel, "failed"),
      ]);
      const key = channel === "instagram" || channel === "facebook" ? "meta" : channel;
      let token: ChannelHealth["token"];
      let label: string | null = null;
      if (key === "meta") {
        token = tokenHealth(settings.get("meta") ?? null, now);
        if (token.expiresAt === "never") token = { ...token, expiresAt: null };
      } else {
        ({ label, ...token } = oauthTokenHealth(settings.get(key) ?? null, now));
      }
      const deadRow =
        failed?.error === "token_dead" &&
        (posted?.posted_at == null || posted.posted_at < failed.updated_at);
      const reads = channel === "x" ? xReads(settings.get("x") ?? null, now) : undefined;
      return {
        channel,
        level: worst(token.level, deadRow ? "red" : "ok", reads?.level ?? "ok"),
        label,
        lastPost:
          posted?.posted_at == null ? null : { at: posted.posted_at, permalink: posted.permalink },
        lastError:
          failed === null ? null : { at: failed.updated_at, error: failed.error ?? "failed" },
        token,
        ...(reads === undefined ? {} : { reads }),
      };
    }),
  );
}

const postAudit = (actor: AdminActor, id: string) => ({ p_id: id, ...auditContext(actor) });

/** @public `POST /api/admin/channels/posts/:id/retry`: the failed row back to scheduled and one step job (DB-09). */
// STUB(B10 step 8): channels.posts.$id.retry.ts calls it
export async function retryPost(
  actor: AdminActor,
  db: Db,
  input: { id: string; force?: boolean | undefined },
): Promise<{ job_id: string }> {
  authorize(actor, "channels.retry");
  const { data, error } = await db.rpc("retry_social_post", {
    ...postAudit(actor, input.id),
    p_force: input.force === true,
  });
  if (error !== null) throw fromRpcError(error);
  return { job_id: data };
}

/** @public `POST /api/admin/channels/posts/:id/cancel`: a scheduled row becomes failed with `cancelled`. */
// STUB(B10 step 8): channels.posts.$id.cancel.ts calls it
export async function cancelPost(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<{ cancelled: true }> {
  authorize(actor, "channels.cancel");
  const { error } = await db.rpc("cancel_social_post", postAudit(actor, input.id));
  if (error !== null) throw fromRpcError(error);
  return { cancelled: true };
}

/** @public `POST /api/admin/channels/posts/:id/metrics-refresh`: the reconcile job reads it; answers 202 (invariant 1). */
// STUB(B10 step 8): channels.posts.$id.metrics-refresh.ts calls it
export async function refreshMetrics(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<Response> {
  authorize(actor, "channels.metrics_refresh");
  const { data, error } = await db.rpc("refresh_social_post_metrics", postAudit(actor, input.id));
  if (error !== null) throw fromRpcError(error);
  return adminJson({ job_id: data }, { status: 202 });
}

/** @public `POST /api/admin/channels/posts/:id/withdrawn`: a person deleted the taken-down post by hand (invariant 10). */
// STUB(B10 step 8): channels.posts.$id.withdrawn.ts calls it
export async function markWithdrawn(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<{ withdrawn: true }> {
  authorize(actor, "channels.mark_withdrawn");
  const { error } = await db.rpc("mark_social_post_withdrawn", postAudit(actor, input.id));
  if (error !== null) throw fromRpcError(error);
  return { withdrawn: true };
}

/**
 * `PUT /api/admin/channels/ids/:key`: the non-secret ids of one channel. A field outside `channelIdsSchema[key]`,
 * a token above all, is 422 `unknown_field` before any database call (G21).
 */
export async function putChannelIds(
  actor: AdminActor,
  db: Db,
  key: ChannelIdsKey,
  body: Record<string, unknown>,
): Promise<{ key: ChannelIdsKey; value: Record<string, unknown> }> {
  authorize(actor, "channels.ids_put");
  const parsed = channelIdsSchema[key].safeParse(body);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
      throw new AppError(
        "unknown_field",
        undefined,
        "Only the account ids of this channel can be stored.",
      );
    }
    throw fromZod(parsed.error);
  }
  const { data, error } = await db.rpc("put_channel_ids", {
    p_key: key,
    p_value: parsed.data,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { key, value: z.record(z.string(), z.unknown()).parse(data) };
}
