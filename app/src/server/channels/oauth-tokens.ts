import { z } from "zod";
import type { Json } from "../../db/index.ts";
import { socialChannelLabels } from "../../domain/channels.ts";
import type { StepContext } from "../jobs/types.ts";
import { sha256Hex } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { mediaUrl } from "../lib/media-store.ts";
import { liveSideEffects, readVar } from "../lib/runtime-env.ts";
import { classifyLinkedInError } from "./linkedin-errors.ts";
import type { Channel } from "./types.ts";
import { classifyXError } from "./x-errors.ts";

// What the X and LinkedIn adapters share (B10 Contract, G21): the rotating OAuth token kept in Vault, one
// authorised call that refreshes once on a 401, the daily token check, and the fetch of a published file's bytes.
// A token never goes to `settings`; `settings.x` and `settings.linkedin` hold ids, the read count and the check.

export type OAuthChannel = "x" | "linkedin";

export interface ChannelFailure {
  class: "retry_at" | "retryable" | "non_retryable" | "token_dead";
  status: number | null;
  /** `invalid_grant` for a refused refresh, `version_expired` for a LinkedIn version no longer served. */
  reason: string | null;
  /** The platform's own reset time for a `retry_at`, or null when it named none. */
  retryAt: Date | null;
  message: string;
}

/** An X or LinkedIn answer that was not 2xx: `detail.class` tells the caller what to do next. */
export class ChannelApiError extends Error {
  readonly detail: ChannelFailure;

  constructor(detail: ChannelFailure) {
    super(detail.message);
    this.name = "ChannelApiError";
    this.detail = detail;
  }
}

/** The part of a step context the token helpers read; the reconcile job passes its own. */
export type TokenContext = Pick<StepContext, "db" | "now" | "signal">;

// STUB(B10 step 6): social.sql adds these three functions and `src/db/types.ts` lists them; the calls then use the typed `db.rpc`
interface UntypedRpc {
  rpc(fn: string, args: Record<string, Json>): PromiseLike<{ data: unknown; error: unknown }>;
}

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The job system did not answer (${what}).`);

/** One call of a social.sql function; a failure is a 503 the runner retries. */
async function socialRpc(
  db: Db,
  fn: "store_channel_token" | "record_channel_check" | "record_channel_usage",
  args: Record<string, Json>,
): Promise<unknown> {
  const client: UntypedRpc = db;
  const { data, error } = await client.rpc(fn, args);
  if (error !== null) throw unavailable(fn);
  return data;
}

/** The `settings` row of a channel: ids, the read count and the last check. */
export async function readChannelSettings(db: Db, key: OAuthChannel): Promise<unknown> {
  const { data, error } = await db.from("settings").select("value").eq("key", key);
  if (error !== null) throw unavailable(`settings.${key}`);
  return data[0]?.value;
}

const PLATFORMS = {
  x: {
    tokenEndpoint: "https://api.x.com/2/oauth2/token",
    check: "https://api.x.com/2/users/me",
    secrets: "X",
  },
  linkedin: {
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    check: "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee",
    secrets: "LINKEDIN",
  },
} as const;

/** The headers every LinkedIn REST call carries: the pinned version and the Rest.li protocol. */
export const linkedInHeaders = (apiVersion: string): Record<string, string> => ({
  "LinkedIn-Version": apiVersion,
  "X-Restli-Protocol-Version": "2.0.0",
});

const linkedInVersionSchema = z.object({ api_version: z.string().min(1) }).passthrough();

const tokenSetSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.string(),
});
type TokenSet = z.infer<typeof tokenSetSchema>;

const refreshAnswerSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number(),
  })
  .passthrough();
const storeAnswerSchema = z.enum(["stored", "busy", "stale"]);

interface ChannelToken {
  accessToken: string;
  expiresAt: string;
  /** True when the token was refreshed for this call, so a 401 with it means the grant is gone. */
  refreshed: boolean;
}

const MINUTE_MS = 60_000;
const REFRESH_WITHIN_MS = 10 * MINUTE_MS;
const CHECK_REFRESH_WITHIN_MS = 24 * 60 * MINUTE_MS;
const SETTLE_WAIT_MS = 2_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function classify(
  channel: OAuthChannel,
  response: Response,
  body: unknown,
  refreshed: boolean,
  now: Date,
): ChannelFailure {
  return channel === "x"
    ? classifyXError(response.status, body, response.headers, refreshed)
    : classifyLinkedInError(response.status, body, response.headers, refreshed, now);
}

/** What `JSON.parse` gives is JSON; the guard only tells the type checker so. */
function isJson(value: unknown): value is Json {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value).every(isJson);
}

/** The answer as JSON; an empty body is null and a body that is not JSON is kept as its text. */
async function readBody(response: Response): Promise<Json> {
  const text = await response.text();
  if (text === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  return isJson(parsed) ? parsed : text;
}

/** A platform call. A rejection is replaced by a message without the URL, which may carry a query worth keeping out. */
async function send(channel: OAuthChannel, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new AppError("unavailable", undefined, `${socialChannelLabels[channel]} did not answer.`);
  }
}

async function readStored(db: Db, channel: OAuthChannel): Promise<TokenSet | null> {
  const { data, error } = await db.rpc("get_vault_secret", { p_name: `${channel}_oauth_token` });
  if (error !== null) throw unavailable("get_vault_secret");
  if (!data) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    value = null;
  }
  const set = tokenSetSchema.safeParse(value);
  if (!set.success) {
    throw new AppError("server", undefined, `The stored ${channel} token set is unreadable.`);
  }
  return set.data;
}

/** The env seed (`X_ACCESS_TOKEN`, `X_REFRESH_TOKEN`). It carries no expiry, so its first use refreshes it into Vault. */
function seed(channel: OAuthChannel): TokenSet | null {
  const prefix = PLATFORMS[channel].secrets;
  const access = readVar(`${prefix}_ACCESS_TOKEN`);
  const refresh = readVar(`${prefix}_REFRESH_TOKEN`);
  if (!access || !refresh) return null;
  return { access_token: access, refresh_token: refresh, expires_at: new Date(0).toISOString() };
}

/**
 * Records the dead token (health turns red) and enqueues one admin alert per channel per UTC day: the key repeats
 * within the day, so `enqueue_job` keeps the first.
 */
async function markTokenDead(ctx: TokenContext, channel: OAuthChannel, cause: string) {
  await socialRpc(ctx.db, "record_channel_check", {
    p_channel: channel,
    p_expires_at: null,
    p_checked_at: ctx.now.toISOString(),
    p_state: "dead",
  });
  const label = socialChannelLabels[channel];
  // STUB(B10 step 6): the alert goes through `notifyAdmin` of post-to-channel.ts, which also reports it to Sentry (INT-04)
  await enqueueJob(ctx.db, {
    type: "notify_admin",
    idempotencyKey: `token_dead:${channel}:${ctx.now.toISOString().slice(0, 10)}`,
    params: { headline: `${label} needs to be reconnected` },
    data: {
      summary: `The ${label} token was refused (${cause}). Run the authorize script again (docs/runbooks/social.md) or renew the Meta token (docs/runbooks/meta.md).`,
      link_path: "/admin/channels",
    },
  });
}

/**
 * The error for an answer that was not 2xx. A `token_dead` is recorded and alerted first, whatever its cause (a
 * refused refresh, a client secret the token endpoint no longer accepts, a 401 after a refresh), so the caller never
 * holds a dead token that `settings` does not show.
 */
async function refused(ctx: TokenContext, channel: OAuthChannel, failure: ChannelFailure) {
  if (failure.class === "token_dead") {
    await markTokenDead(ctx, channel, failure.reason ?? String(failure.status));
  }
  return new ChannelApiError(failure);
}

function clientCredentials(channel: OAuthChannel): { id: string; secret: string } {
  const prefix = PLATFORMS[channel].secrets;
  const id = readVar(`${prefix}_CLIENT_ID`);
  const secret = readVar(`${prefix}_CLIENT_SECRET`);
  if (!id || !secret) {
    throw new AppError(
      "server",
      undefined,
      `${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET are not set.`,
    );
  }
  return { id, secret };
}

function refreshRequest(channel: OAuthChannel, refreshToken: string): RequestInit {
  const client = clientCredentials(channel);
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  form.set("client_id", client.id);
  // X takes a confidential client's secret as Basic auth, LinkedIn in the form.
  if (channel === "x") headers["Authorization"] = `Basic ${btoa(`${client.id}:${client.secret}`)}`;
  else form.set("client_secret", client.secret);
  return { method: "POST", headers, body: form };
}

const fresh = (set: TokenSet): ChannelToken => ({
  accessToken: set.access_token,
  expiresAt: set.expires_at,
  refreshed: true,
});

/**
 * Trades the refresh token for a new set and stores it with one `store_channel_token` call, which holds the channel's
 * advisory lock and compares the refresh token sent with Vault's (G21). `busy` or `stale` means another run stored
 * first: this set is dropped and Vault's is read after 2 seconds. An `invalid_grant` is dead only when Vault still
 * holds the refresh token that was sent; otherwise another run refreshed in between and its set is used.
 */
async function refresh(ctx: TokenContext, channel: OAuthChannel, held: TokenSet) {
  const sent = held.refresh_token;
  const response = await send(channel, PLATFORMS[channel].tokenEndpoint, {
    ...refreshRequest(channel, sent),
    signal: ctx.signal,
  });
  const body = await readBody(response);
  if (!response.ok) {
    const failure = classify(channel, response, body, true, ctx.now);
    if (failure.reason === "invalid_grant") {
      const current = await readStored(ctx.db, channel);
      if (current !== null && current.refresh_token !== sent) return fresh(current);
    }
    throw await refused(ctx, channel, failure);
  }
  const answer = refreshAnswerSchema.safeParse(body);
  if (!answer.success) {
    throw new AppError(
      "unavailable",
      undefined,
      `The ${channel} token endpoint answered an unexpected shape.`,
    );
  }
  const next: TokenSet = {
    access_token: answer.data.access_token,
    refresh_token: answer.data.refresh_token ?? sent,
    expires_at: new Date(ctx.now.getTime() + answer.data.expires_in * 1000).toISOString(),
  };
  const outcome = storeAnswerSchema.safeParse(
    await socialRpc(ctx.db, "store_channel_token", {
      p_channel: channel,
      p_used_refresh_sha256: await sha256Hex(sent),
      p_token_set: next,
    }),
  );
  if (!outcome.success) throw unavailable("store_channel_token");
  if (outcome.data === "stored") return fresh(next);
  await sleep(SETTLE_WAIT_MS);
  const settled = await readStored(ctx.db, channel);
  if (settled === null) throw unavailable(`store_channel_token answered ${outcome.data}`);
  return fresh(settled);
}

/**
 * The access token of `channel`: Vault's `<channel>_oauth_token` first, the env seed second (the rule of
 * `getMetaToken`), refreshed when it expires within `refreshWithinMs` (10 minutes by default) or when `force` is set.
 */
export async function getChannelToken(
  ctx: TokenContext,
  channel: OAuthChannel,
  rule: { refreshWithinMs?: number; force?: boolean } = {},
): Promise<ChannelToken> {
  const held = (await readStored(ctx.db, channel)) ?? seed(channel);
  if (held === null) {
    throw new AppError(
      "server",
      undefined,
      `No ${channel} token is stored: run scripts/${channel}-authorize.ts.`,
    );
  }
  const left = Date.parse(held.expires_at) - ctx.now.getTime();
  if (rule.force !== true && left > (rule.refreshWithinMs ?? REFRESH_WITHIN_MS)) {
    return { accessToken: held.access_token, expiresAt: held.expires_at, refreshed: false };
  }
  return refresh(ctx, channel, held);
}

/** Adds one X read to `settings.x.usage` (INT-08). */
async function recordXRead(db: Db): Promise<void> {
  await socialRpc(db, "record_channel_usage", { p_channel: "x", p_reads: 1 });
}

/**
 * One authorised call to X or LinkedIn. A write (any method but GET) goes out only when `liveSideEffects("social")`
 * says so (R35); reads always do. A 401 with a token that was not refreshed for this call refreshes it and
 * sends once more; a 401 after a refresh, like a refused refresh, records the token dead. Every X GET is a read and is
 * counted once. An answer that is not 2xx throws `ChannelApiError` with its class.
 */
export async function callApi(
  ctx: TokenContext,
  channel: OAuthChannel,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit },
  refreshWithinMs = REFRESH_WITHIN_MS,
): Promise<{ body: Json; headers: Headers; token: ChannelToken }> {
  const method = init.method ?? "GET";
  if (method !== "GET" && !liveSideEffects("social")) {
    throw new AppError(
      "server",
      undefined,
      "Posting is switched off here: no write call was made.",
    );
  }
  const attempt = (token: ChannelToken) =>
    send(channel, url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token.accessToken}` },
      signal: ctx.signal,
    });
  let token = await getChannelToken(ctx, channel, { refreshWithinMs });
  let response = await attempt(token);
  if (response.status === 401 && !token.refreshed) {
    token = await getChannelToken(ctx, channel, { force: true });
    response = await attempt(token);
  }
  if (channel === "x" && method === "GET") await recordXRead(ctx.db);
  const body = await readBody(response);
  if (response.ok) return { body, headers: response.headers, token };
  throw await refused(ctx, channel, classify(channel, response, body, token.refreshed, ctx.now));
}

/**
 * The bytes of a published file from its public address (H33 (2)). Any answer other than 200 throws, naming the
 * status and the key, before the caller uploads or posts anything; the runner retries the job.
 */
export async function mediaBytes(key: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(mediaUrl(key, { absolute: true }), { signal });
  } catch {
    throw new AppError("storage_unavailable", undefined, `The file ${key} did not answer.`);
  }
  if (response.status !== 200) {
    throw new AppError(
      "storage_unavailable",
      undefined,
      `The file ${key} answered ${String(response.status)}.`,
    );
  }
  return response.blob();
}

/**
 * The daily check of the reconcile job: refreshes a token that expires within 24 hours (rotating refresh tokens stay
 * alive), makes one read-only call and stores the result with one `record_channel_check`. A dead token or an expired
 * LinkedIn version is stored and returned; a network error or a 5xx stores nothing and throws, for the caller to count.
 */
export async function checkChannelToken(
  ctx: TokenContext,
  channel: OAuthChannel,
): Promise<"ok" | "dead" | "version_expired"> {
  let headers: Record<string, string> = {};
  if (channel === "linkedin") {
    const settings = linkedInVersionSchema.safeParse(await readChannelSettings(ctx.db, channel));
    if (!settings.success) {
      throw new AppError("server", undefined, "settings.linkedin needs api_version.");
    }
    headers = linkedInHeaders(settings.data.api_version);
  }
  const record = (state: "ok" | "version_expired", expiresAt: string | null) =>
    socialRpc(ctx.db, "record_channel_check", {
      p_channel: channel,
      p_expires_at: expiresAt,
      p_checked_at: ctx.now.toISOString(),
      p_state: state,
    });
  try {
    const { token } = await callApi(
      ctx,
      channel,
      PLATFORMS[channel].check,
      { headers },
      CHECK_REFRESH_WITHIN_MS,
    );
    await record("ok", token.expiresAt);
    return "ok";
  } catch (error) {
    if (!(error instanceof ChannelApiError)) throw error;
    if (error.detail.class === "token_dead") return "dead";
    if (error.detail.reason !== "version_expired") throw error;
    await record("version_expired", null);
    return "version_expired";
  }
}

const checkSchema = z
  .object({ token_state: z.string().optional(), token_checked_at: z.string().optional() })
  .passthrough();

/** A channel card's state from the last daily check: a dead token is red, an expired LinkedIn version amber. */
export function tokenState(settings: unknown): Awaited<ReturnType<Channel["health"]>> {
  const check = checkSchema.safeParse(settings).data;
  const state = check?.token_state;
  if (state === "ok") {
    return { state: "ok", detail: `Checked on ${(check?.token_checked_at ?? "").slice(0, 10)}.` };
  }
  if (state === "dead") {
    return { state: "red", detail: "The token was refused. Run the authorize script again." };
  }
  if (state === "version_expired") return { state: "amber", detail: "API version expired" };
  return { state: "amber", detail: "Not checked yet." };
}
