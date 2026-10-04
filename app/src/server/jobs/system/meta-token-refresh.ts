import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { enqueueJob } from "../../lib/jobs.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";

// The daily Meta token check (GS-01, INT-06), the adapter of the Graph calls it makes (R32). It does nothing until the
// owner has stored the account ids (B10 step 1). It reads the token as B10's getMetaToken does (Vault first, then the
// function secret), records what debug_token says, alerts an admin when the token is dead or about to expire, and
// renews a token that has a refresh route. A Graph network error or 5xx throws, so the job retries.

/** The permissions publishing and insights need (INT-06); one missing one records `scopes_missing`. */
export const META_REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_ALERT_DAYS = 7;
const NOTIFY_ATTEMPTS = 12;
const LINK_PATH = "/admin/channels";

const metaSettingsSchema = z
  .object({
    page_id: z.string().min(1),
    ig_user_id: z.string().min(1),
    graph_version: z.string().min(1),
  })
  .passthrough();
type MetaSettings = z.infer<typeof metaSettingsSchema>;

const debugSchema = z
  .object({
    data: z
      .object({
        type: z.string().optional(),
        is_valid: z.boolean(),
        expires_at: z.number(),
        data_access_expires_at: z.number().optional(),
        scopes: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();
type DebugToken = z.infer<typeof debugSchema>["data"];

const refreshSchema = z
  .object({ access_token: z.string().min(1), expires_in: z.number().optional() })
  .passthrough();

type TokenState = "ok" | "dead" | "scopes_missing";

function unavailable(what: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${what}).`);
}

/** A Graph time in seconds, where 0 means never. */
const fromSeconds = (seconds: number | undefined): Date | null =>
  seconds === undefined || seconds === 0 ? null : new Date(seconds * 1000);

async function readSettings(db: Db): Promise<MetaSettings | null> {
  const { data, error } = await db.from("settings").select("value").eq("key", "meta").maybeSingle();
  if (error !== null) throw unavailable("settings");
  const parsed = metaSettingsSchema.safeParse(data?.value);
  return parsed.success ? parsed.data : null;
}

async function readToken(ctx: StepContext): Promise<string | undefined> {
  const { data, error } = await ctx.db.rpc("get_vault_secret", { p_name: "meta_page_token" });
  if (error !== null) throw unavailable("get_vault_secret");
  return data || ctx.env["META_PAGE_TOKEN"] || undefined;
}

/**
 * The URL carries the token and the app secret, and a runtime's network error quotes the URL, so a rejection is
 * replaced by a message without it: the job's error is stored and shown to staff.
 */
async function graphGet(ctx: StepContext, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal: ctx.signal });
  } catch {
    throw new AppError("unavailable", undefined, "Graph did not answer.");
  }
  if (!response.ok)
    throw new AppError("unavailable", undefined, `Graph answered ${String(response.status)}.`);
  try {
    return await response.json();
  } catch {
    throw new AppError("unavailable", undefined, "Graph answered a body that could not be read.");
  }
}

function stateOf(token: DebugToken): { state: TokenState; missing: string[] } {
  if (!token.is_valid) return { state: "dead", missing: [] };
  const granted = new Set(token.scopes ?? []);
  const missing = META_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
  return { state: missing.length > 0 ? "scopes_missing" : "ok", missing };
}

async function record(
  ctx: StepContext,
  fields: { state: TokenState; missing: string[]; expiresAt: Date | null; dataAccess: Date | null },
  newToken?: string,
): Promise<string> {
  const { data, error } = await ctx.db.rpc("meta_token_record", {
    p_checked_at: ctx.now.toISOString(),
    p_token_state: fields.state,
    p_missing_scopes: fields.missing,
    ...(fields.expiresAt === null ? {} : { p_expires_at: fields.expiresAt.toISOString() }),
    ...(fields.dataAccess === null
      ? {}
      : { p_data_access_expires_at: fields.dataAccess.toISOString() }),
    ...(newToken === undefined ? {} : { p_new_token: newToken }),
  });
  if (error !== null) throw unavailable("meta_token_record");
  return data;
}

/** The G13 producer contract of notify_admin: a headline, a summary and the screen to open. */
async function notifyAdmin(
  ctx: StepContext,
  key: string,
  headline: string,
  summary: string,
): Promise<void> {
  await enqueueJob(ctx.db, {
    type: "notify_admin",
    idempotencyKey: `${key}:${ctx.now.toISOString().slice(0, 10)}`,
    params: { headline },
    data: { summary, link_path: LINK_PATH },
    maxAttempts: NOTIFY_ATTEMPTS,
  });
}

/** The refresh route of the token's type: a user token is exchanged, an Instagram login token refreshed, a page token has none. */
function refreshUrl(
  ctx: StepContext,
  meta: MetaSettings,
  token: string,
  type: string | undefined,
): string | null {
  if (token.startsWith("IG")) {
    return `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  }
  if (type !== "USER") return null;
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: ctx.env["META_APP_ID"] ?? "",
    client_secret: ctx.env["META_APP_SECRET"] ?? "",
    fb_exchange_token: token,
  });
  return `https://graph.facebook.com/${meta.graph_version}/oauth/access_token?${params.toString()}`;
}

/** The renewed token and its expiry, or null when there is no route or the route failed. */
async function refresh(
  ctx: StepContext,
  meta: MetaSettings,
  token: string,
  type: string | undefined,
): Promise<{ token: string; expiresAt: Date | null } | null> {
  const url = refreshUrl(ctx, meta, token, type);
  if (url === null) return null;
  try {
    const parsed = refreshSchema.safeParse(await graphGet(ctx, url));
    if (!parsed.success) return null;
    const { access_token, expires_in } = parsed.data;
    return {
      token: access_token,
      expiresAt: expires_in === undefined ? null : new Date(ctx.now.getTime() + expires_in * 1000),
    };
  } catch (error) {
    ctx.log("warn", "meta_token_refresh_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const metaTokenRefresh: SystemJobDefinition = {
  type: "meta_token_refresh",
  maxAttempts: 12,
  async run(ctx) {
    const meta = await readSettings(ctx.db);
    if (meta === null) return { status: "done", result: { skipped: "not_configured" } };
    const token = await readToken(ctx);
    const appId = ctx.env["META_APP_ID"];
    const appSecret = ctx.env["META_APP_SECRET"];
    if (!token || !appId || !appSecret) {
      return { status: "done", result: { skipped: "not_configured" } };
    }
    const debugUrl = `https://graph.facebook.com/${meta.graph_version}/debug_token?${new URLSearchParams(
      {
        input_token: token,
        access_token: `${appId}|${appSecret}`,
      },
    ).toString()}`;
    const parsed = debugSchema.safeParse(await graphGet(ctx, debugUrl));
    if (!parsed.success)
      throw new AppError(
        "unavailable",
        undefined,
        "Graph answered an unexpected debug_token shape.",
      );
    const debug = parsed.data.data;
    const { state, missing } = stateOf(debug);
    const expiresAt = fromSeconds(debug.expires_at);
    const dataAccess = fromSeconds(debug.data_access_expires_at);
    if ((await record(ctx, { state, missing, expiresAt, dataAccess })) === "locked") {
      return { status: "done", result: { skipped: "locked" } };
    }
    if (state === "dead") {
      await notifyAdmin(
        ctx,
        "token_dead:instagram",
        "Instagram token is no longer valid",
        "Meta reports the Instagram token as no longer valid. Reconnect it on the channels screen.",
      );
      return { status: "done", result: { token_state: state, alerted: true } };
    }
    const daysLeft =
      expiresAt === null ? null : Math.floor((expiresAt.getTime() - ctx.now.getTime()) / DAY_MS);
    if (daysLeft === null || daysLeft >= EXPIRY_ALERT_DAYS) {
      return { status: "done", result: { token_state: state, days_left: daysLeft } };
    }
    const renewed = await refresh(ctx, meta, token, debug.type);
    if (renewed !== null) {
      const stored = await record(
        ctx,
        { state: "ok", missing: [], expiresAt: renewed.expiresAt, dataAccess },
        renewed.token,
      );
      // The old token stays valid, so a retry renews again and stores what this run could not.
      if (stored === "locked") {
        throw new AppError(
          "unavailable",
          undefined,
          "The renewed Meta token was not stored: another run holds it.",
        );
      }
      return { status: "done", result: { token_state: "ok", refreshed: true } };
    }
    await notifyAdmin(
      ctx,
      "meta_token_expiry",
      `Meta token expires in ${String(daysLeft)} days`,
      `The Meta token expires in ${String(daysLeft)} days and could not be renewed here. Renew it on the channels screen.`,
    );
    return { status: "done", result: { token_state: state, days_left: daysLeft, alerted: true } };
  },
};
