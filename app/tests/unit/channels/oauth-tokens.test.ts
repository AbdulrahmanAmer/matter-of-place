// B10 step 5a: the rotating X and LinkedIn tokens (G21). Vault, `store_channel_token`, `record_channel_check` and
// `enqueue_job` are a stubbed `db.rpc` (fakeDb); the token endpoints and the read-only checks are a fetch stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ChannelApiError,
  checkChannelToken,
  getChannelToken,
} from "../../../src/server/channels/oauth-tokens.ts";
import { sha256Hex } from "../../../src/server/lib/crypto.ts";
import { context, NOW } from "../../fixtures/asset-rows";
import {
  Answer,
  answerOf,
  requestOf,
  rpcArgs,
  socialDb,
  stubPlatform,
  type SocialDbOptions,
} from "../../fixtures/social-api";

const X_TOKEN = requestOf("x", "token-refresh");
const LINKEDIN_TOKEN = requestOf("linkedin", "token-refresh");
const ME = requestOf("x", "users-me");
const ACLS = requestOf("linkedin", "organization-acls");
const set = (name: string, expiresAt: string) => ({
  access_token: `${name}-access`,
  refresh_token: `${name}-refresh`,
  expires_at: expiresAt,
});
// NOW is 2026-10-04T12:00Z: one set has an hour left, one five minutes, one two days.
const HOUR_LEFT = set("x-held", "2026-10-04T13:00:00.000Z");
const EXPIRING = set("x-held", "2026-10-04T12:05:00.000Z");
const DAYS_LEFT = set("x-held", "2026-10-06T12:00:00.000Z");
const OTHER = set("x-other", "2026-10-04T14:00:00.000Z");

const ctx = (options: SocialDbOptions = {}, now = NOW) => {
  const db = socialDb(options);
  return { db, ctx: { ...context(db, "post_x"), now } };
};

/** The rejection of `promise`: a test that expects a failure reads it instead of catching it. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

const formOf = (body: unknown) =>
  body instanceof URLSearchParams ? Object.fromEntries(body) : null;

const tick = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("X_CLIENT_ID", "x-client");
  vi.stubEnv("X_CLIENT_SECRET", "x-secret");
  vi.stubEnv("LINKEDIN_CLIENT_ID", "linkedin-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "linkedin-secret");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getChannelToken", () => {
  it("returns Vault's token while it has more than 10 minutes left, and makes no request", async () => {
    const api = stubPlatform({});
    const { ctx: context } = ctx({ vault: HOUR_LEFT });
    expect(await getChannelToken(context, "x")).toEqual({
      accessToken: "x-held-access",
      expiresAt: HOUR_LEFT.expires_at,
      refreshed: false,
    });
    expect(api.spy).not.toHaveBeenCalled();
  });

  it("takes Vault over the env seed", async () => {
    vi.stubEnv("X_ACCESS_TOKEN", "x-env-access");
    vi.stubEnv("X_REFRESH_TOKEN", "x-env-refresh");
    stubPlatform({});
    const { ctx: context } = ctx({ vault: HOUR_LEFT });
    expect((await getChannelToken(context, "x")).accessToken).toBe("x-held-access");
  });

  it("refreshes the env seed into Vault when Vault is empty", async () => {
    vi.stubEnv("X_ACCESS_TOKEN", "x-env-access");
    vi.stubEnv("X_REFRESH_TOKEN", "x-env-refresh");
    const api = stubPlatform({ [X_TOKEN]: answerOf("x", "token-refresh") });
    const { db, ctx: context } = ctx({ vault: null });
    expect((await getChannelToken(context, "x")).accessToken).toBe("x-access-fresh");
    expect(formOf(api.sent[0]?.body)?.["refresh_token"]).toBe("x-env-refresh");
    expect(rpcArgs(db, "store_channel_token")).toMatchObject([
      { p_used_refresh_sha256: await sha256Hex("x-env-refresh") },
    ]);
  });

  it("refreshes a token with 10 minutes or less left and stores the new set once, with the sha256 of the refresh token it sent", async () => {
    const api = stubPlatform({ [X_TOKEN]: answerOf("x", "token-refresh") });
    const { db, ctx: context } = ctx({ vault: EXPIRING });
    expect(await getChannelToken(context, "x")).toEqual({
      accessToken: "x-access-fresh",
      expiresAt: "2026-10-04T14:00:00.000Z",
      refreshed: true,
    });
    expect(api.calls()).toEqual([X_TOKEN]);
    expect(formOf(api.sent[0]?.body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "x-held-refresh",
      client_id: "x-client",
    });
    expect(api.sent[0]?.headers.get("authorization")).toBe(`Basic ${btoa("x-client:x-secret")}`);
    expect(rpcArgs(db, "store_channel_token")).toEqual([
      {
        p_channel: "x",
        p_used_refresh_sha256: await sha256Hex("x-held-refresh"),
        p_token_set: {
          access_token: "x-access-fresh",
          refresh_token: "x-refresh-fresh",
          expires_at: "2026-10-04T14:00:00.000Z",
        },
      },
    ]);
  });

  it("sends LinkedIn's client secret in the form, not as Basic auth", async () => {
    const api = stubPlatform({ [LINKEDIN_TOKEN]: answerOf("linkedin", "token-refresh") });
    const { ctx: context } = ctx({ vault: set("linkedin-held", "2026-10-04T12:01:00.000Z") });
    expect((await getChannelToken(context, "linkedin")).accessToken).toBe("linkedin-access-fresh");
    expect(formOf(api.sent[0]?.body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "linkedin-held-refresh",
      client_id: "linkedin-client",
      client_secret: "linkedin-secret",
    });
    expect(api.sent[0]?.headers.has("authorization")).toBe(false);
  });

  it.each(["busy", "stale"] as const)(
    "on %s, discards its own set, waits 2 seconds and returns Vault's",
    async (answer) => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      stubPlatform({ [X_TOKEN]: answerOf("x", "token-refresh") });
      const { db, ctx: context } = ctx({ vault: [EXPIRING, OTHER], store: answer });
      let settled = false;
      const token = getChannelToken(context, "x").finally(() => {
        settled = true;
      });
      while (vi.getTimerCount() === 0) await tick();
      await vi.advanceTimersByTimeAsync(1_999);
      expect({ settled, reads: rpcArgs(db, "get_vault_secret").length }).toEqual({
        settled: false,
        reads: 1,
      });
      await vi.advanceTimersByTimeAsync(1);
      expect((await token).accessToken).toBe("x-other-access");
      expect(rpcArgs(db, "store_channel_token")).toHaveLength(1);
    },
  );

  it("uses Vault's set on invalid_grant when Vault holds another refresh token than the one sent", async () => {
    stubPlatform({ [X_TOKEN]: answerOf("x", "invalid-grant") });
    const { db, ctx: context } = ctx({ vault: [EXPIRING, OTHER] });
    expect((await getChannelToken(context, "x")).accessToken).toBe("x-other-access");
    expect(rpcArgs(db, "record_channel_check")).toEqual([]);
    expect(rpcArgs(db, "enqueue_job")).toEqual([]);
  });

  it("maps invalid_grant with the same refresh token to token_dead, records it and alerts once per day", async () => {
    stubPlatform({ [X_TOKEN]: answerOf("x", "invalid-grant") });
    const { db, ctx: context } = ctx({ vault: EXPIRING });
    const error = await failure(getChannelToken(context, "x"));
    expect(error instanceof ChannelApiError ? error.detail.class : error.message).toBe(
      "token_dead",
    );
    await failure(getChannelToken(context, "x"));
    await failure(getChannelToken({ ...context, now: new Date("2026-10-05T08:00:00.000Z") }, "x"));
    expect(rpcArgs(db, "record_channel_check")[0]).toEqual({
      p_channel: "x",
      p_expires_at: null,
      p_checked_at: NOW.toISOString(),
      p_state: "dead",
    });
    expect(rpcArgs(db, "enqueue_job")[0]).toMatchObject({
      p_type: "notify_admin",
      p_idempotency_key: "token_dead:x:2026-10-04",
      p_payload: {
        params: { headline: "X needs to be reconnected" },
        data: { link_path: "/admin/channels" },
      },
    });
    const keys = rpcArgs(db, "enqueue_job").map(
      (args) => z.object({ p_idempotency_key: z.string() }).parse(args).p_idempotency_key,
    );
    expect(keys).toEqual([
      "token_dead:x:2026-10-04",
      "token_dead:x:2026-10-04",
      "token_dead:x:2026-10-05",
    ]);
  });
});

describe("checkChannelToken", () => {
  const LINKEDIN_SETTINGS = {
    key: "linkedin" as const,
    value: { organization_urn: "urn:li:organization:100000001", api_version: "202509" },
  };

  it("makes one read-only call and calls record_channel_check once with ok, the expiry and the time", async () => {
    const api = stubPlatform({ [ME]: answerOf("x", "users-me") });
    const { db, ctx: context } = ctx({ vault: DAYS_LEFT });
    expect(await checkChannelToken(context, "x")).toBe("ok");
    expect(api.calls()).toEqual([ME]);
    expect(rpcArgs(db, "record_channel_check")).toEqual([
      {
        p_channel: "x",
        p_expires_at: DAYS_LEFT.expires_at,
        p_checked_at: NOW.toISOString(),
        p_state: "ok",
      },
    ]);
    expect(rpcArgs(db, "record_channel_usage")).toEqual([{ p_channel: "x", p_reads: 1 }]);
  });

  it("refreshes a token that expires within 24 hours before the check", async () => {
    const api = stubPlatform({
      [X_TOKEN]: answerOf("x", "token-refresh"),
      [ME]: answerOf("x", "users-me"),
    });
    const { db, ctx: context } = ctx({ vault: HOUR_LEFT });
    expect(await checkChannelToken(context, "x")).toBe("ok");
    expect(api.calls()).toEqual([X_TOKEN, ME]);
    expect(rpcArgs(db, "record_channel_check")).toMatchObject([
      { p_expires_at: "2026-10-04T14:00:00.000Z", p_state: "ok" },
    ]);
  });

  it("stores version_expired when LinkedIn answers 426 to the read-only call", async () => {
    const api = stubPlatform({ [ACLS]: answerOf("linkedin", "version-expired") });
    const { db, ctx: context } = ctx({
      vault: set("linkedin-held", "2026-11-30T00:00:00.000Z"),
      settings: LINKEDIN_SETTINGS,
    });
    expect(await checkChannelToken(context, "linkedin")).toBe("version_expired");
    expect(api.sent[0]?.headers.get("linkedin-version")).toBe("202509");
    expect(rpcArgs(db, "record_channel_check")).toEqual([
      {
        p_channel: "linkedin",
        p_expires_at: null,
        p_checked_at: NOW.toISOString(),
        p_state: "version_expired",
      },
    ]);
  });

  it("stores dead once and returns it when the refresh answers invalid_grant", async () => {
    stubPlatform({ [X_TOKEN]: answerOf("x", "invalid-grant") });
    const { db, ctx: context } = ctx({ vault: HOUR_LEFT });
    expect(await checkChannelToken(context, "x")).toBe("dead");
    expect(rpcArgs(db, "record_channel_check")).toMatchObject([{ p_state: "dead" }]);
  });

  it.each([
    { channel: "x" as const, url: X_TOKEN, error: "unauthorized_client" },
    { channel: "linkedin" as const, url: LINKEDIN_TOKEN, error: "invalid_client" },
  ])(
    "stores dead and alerts when the $channel token endpoint answers 401 $error",
    async ({ channel, url, error }) => {
      const api = stubPlatform({ [url]: new Answer({ error }, 401) });
      const { db, ctx: context } = ctx({
        vault: set(`${channel}-held`, HOUR_LEFT.expires_at),
        settings: LINKEDIN_SETTINGS,
      });
      expect(await checkChannelToken(context, channel)).toBe("dead");
      expect(api.calls()).toEqual([url]);
      expect(rpcArgs(db, "record_channel_check")).toEqual([
        {
          p_channel: channel,
          p_expires_at: null,
          p_checked_at: NOW.toISOString(),
          p_state: "dead",
        },
      ]);
      expect(rpcArgs(db, "enqueue_job")).toMatchObject([
        { p_type: "notify_admin", p_idempotency_key: `token_dead:${channel}:2026-10-04` },
      ]);
    },
  );

  it("stores nothing and throws on a 503", async () => {
    stubPlatform({ [ME]: new Answer(null, 503) });
    const { db, ctx: context } = ctx({ vault: DAYS_LEFT });
    const error = await failure(checkChannelToken(context, "x"));
    expect(error instanceof ChannelApiError ? error.detail.class : error.message).toBe("retryable");
    expect(rpcArgs(db, "record_channel_check")).toEqual([]);
  });
});
