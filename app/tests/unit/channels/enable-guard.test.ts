import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db/index.ts";
import type { SocialChannel } from "../../../src/domain/channels.ts";
import { assertMayEnable } from "../../../src/server/channels/enable-guard.ts";
import { fakeDb } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";

// Enabling a channel needs proof of credentials (B10 invariant 9). The flags come from the public state, read on every
// call here (`CATALOG_VERSION_TTL_MS` 0); the channel's ids and checks from its `settings` row.

const now = new Date("2026-10-07T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

function db(key: string, value: NonNullable<Json>, newChannels = false) {
  return fakeDb({
    rpc: { public_state: () => stateJson(7, { flags: { new_channels: newChannels } }) },
    tables: { settings: [{ key, value, updated_at: hoursAgo(1), updated_by: null }] },
  });
}

const meta = { page_id: "1", ig_user_id: "2", token_checked_at: hoursAgo(1), token_state: "ok" };
const refused = (code: string, message: RegExp) => ({ code, status: 422, message });

describe("assertMayEnable", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now });
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("refuses x without token_checked_at and with a check 3 days old", async () => {
    await expect(assertMayEnable(db("x", { user_id: "5" }), "x")).rejects.toMatchObject(
      refused("credentials_unverified", /token_checked_at/),
    );
    await expect(
      assertMayEnable(db("x", { user_id: "5", token_checked_at: hoursAgo(72) }), "x"),
    ).rejects.toMatchObject(refused("credentials_unverified", /token_checked_at/));
  });

  it("allows x with a check an hour old", async () => {
    await expect(
      assertMayEnable(db("x", { user_id: "5", token_checked_at: hoursAgo(1) }), "x"),
    ).resolves.toBeUndefined();
  });

  it("names a missing id: x user_id, linkedin organization_urn, instagram ig_user_id", async () => {
    const fresh = { token_checked_at: hoursAgo(1) };
    await expect(assertMayEnable(db("x", fresh), "x")).rejects.toMatchObject(
      refused("credentials_unverified", /settings\.x\.user_id/),
    );
    await expect(assertMayEnable(db("linkedin", fresh), "linkedin")).rejects.toMatchObject(
      refused("credentials_unverified", /settings\.linkedin\.organization_urn/),
    );
    await expect(
      assertMayEnable(db("meta", { ...meta, ig_user_id: "" }), "instagram"),
    ).rejects.toMatchObject(refused("credentials_unverified", /settings\.meta\.ig_user_id/));
  });

  it("refuses instagram with a fresh check and token_state dead, allows it with ok", async () => {
    await expect(
      assertMayEnable(db("meta", { ...meta, token_state: "dead" }), "instagram"),
    ).rejects.toMatchObject(refused("credentials_unverified", /token_state is dead/));
    await expect(assertMayEnable(db("meta", meta), "instagram")).resolves.toBeUndefined();
  });

  it("keeps facebook and youtube locked while new_channels is false", async () => {
    for (const channel of ["facebook", "youtube"] satisfies SocialChannel[]) {
      await expect(assertMayEnable(db("meta", meta), channel)).rejects.toMatchObject(
        refused("channel_locked", /new channels/),
      );
    }
    await expect(assertMayEnable(db("meta", meta, true), "facebook")).resolves.toBeUndefined();
  });

  it("answers no_adapter for youtube with the flag on", async () => {
    await expect(assertMayEnable(db("meta", meta, true), "youtube")).rejects.toMatchObject(
      refused("no_adapter", /YouTube/),
    );
  });
});
