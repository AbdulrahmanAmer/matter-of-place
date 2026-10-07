import { afterEach, describe, expect, it, vi } from "vitest";
import { META_REQUIRED_SCOPES as jobScopes } from "../../../src/server/jobs/system/meta-token-refresh.ts";
import {
  getMetaToken,
  META_REQUIRED_SCOPES,
  tokenHealth,
} from "../../../src/server/channels/meta-token.ts";
import { fakeDb } from "../../fixtures/fake-db";

// The Meta token and its health (B10 Contract, INT-06): Vault before the function secret, and the health read from
// what B8's `meta_token_refresh` stored in `settings.meta`.

const vault = (token: string) => fakeDb({ rpc: { get_vault_secret: () => token } });

describe("getMetaToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the Vault token over META_PAGE_TOKEN", async () => {
    vi.stubEnv("META_PAGE_TOKEN", "env-token");
    await expect(getMetaToken(vault("vault-token"))).resolves.toBe("vault-token");
  });

  it("falls back to META_PAGE_TOKEN while Vault holds none, and refuses when neither is set", async () => {
    vi.stubEnv("META_PAGE_TOKEN", "env-token");
    await expect(getMetaToken(vault(""))).resolves.toBe("env-token");
    vi.stubEnv("META_PAGE_TOKEN", "");
    await expect(getMetaToken(vault(""))).rejects.toMatchObject({ code: "server" });
  });

  it("re-exports B8's list of required scopes", () => {
    expect(META_REQUIRED_SCOPES).toBe(jobScopes);
  });
});

describe("tokenHealth", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const ok = { token_state: "ok", token_expires_at: inDays(60), data_access_expires_at: null };

  it("is amber at 14 days left and red at 7", () => {
    expect(tokenHealth({ ...ok, token_expires_at: inDays(15) }, now).level).toBe("ok");
    expect(tokenHealth({ ...ok, token_expires_at: inDays(14) }, now)).toEqual({
      expiresAt: inDays(14),
      daysLeft: 14,
      level: "amber",
    });
    expect(tokenHealth({ ...ok, token_expires_at: inDays(7) }, now).level).toBe("red");
  });

  it("reads a null expiry as never, red when the token is dead", () => {
    expect(tokenHealth({ ...ok, token_expires_at: null }, now)).toEqual({
      expiresAt: "never",
      daysLeft: null,
      level: "ok",
    });
    expect(tokenHealth({ ...ok, token_expires_at: null, token_state: "dead" }, now).level).toBe(
      "red",
    );
  });

  it("is red for missing scopes and for a check that never ran", () => {
    expect(tokenHealth({ ...ok, token_state: "scopes_missing" }, now).level).toBe("red");
    expect(tokenHealth({}, now).level).toBe("red");
  });

  it("is amber when data access ends within 14 days", () => {
    expect(tokenHealth({ ...ok, data_access_expires_at: inDays(10) }, now).level).toBe("amber");
    expect(tokenHealth({ ...ok, data_access_expires_at: inDays(30) }, now).level).toBe("ok");
  });
});
