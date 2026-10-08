// B10 step 6: the admin functions of screen 12 (`src/server/channels/service.ts`). The database is tableDb of
// tests/fixtures/channel-db.ts, whose tables keep only the rows a query's filters keep, and whose RPCs answer what each
// case registers. A platform is never called from here (invariant 1): fetch is a spy that must stay silent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPost,
  channelHealth,
  listPosts,
  markWithdrawn,
  putChannelIds,
  refreshMetrics,
  retryPost,
} from "../../../src/server/channels/service";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { POST, postRow, tableDb, type Handler } from "../../fixtures/channel-db";

const NOW = new Date("2026-10-06T14:00:00.000Z");
const JOB = "3f2a9c1d-0000-4000-8000-0000000000f1";

const actor = (roles: AdminActor["roles"], kind: AdminActor["kind"] = "human"): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind,
  roles,
  scopes: ["channels"],
  requestId: "req-ch",
});
const mediaOps = actor(["media_ops"]);
const commercial = actor(["commercial"]);
const agent = actor(["media_ops", "admin"], "agent");

function db(
  handlers: Record<string, Handler> = {},
  posts = [postRow("x")],
  settings: Record<string, unknown>[] = [],
) {
  return tableDb({ social_posts: posts, settings }, handlers);
}

const rpcs = (database: ReturnType<typeof db>) =>
  database.calls.filter((call) => call.kind === "rpc");

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(fetch).not.toHaveBeenCalled();
});

describe("the actions", () => {
  it.each([
    ["retry", (d: ReturnType<typeof db>) => retryPost(commercial, d, { id: POST })],
    ["cancel", (d: ReturnType<typeof db>) => cancelPost(commercial, d, { id: POST })],
    ["metrics refresh", (d: ReturnType<typeof db>) => refreshMetrics(commercial, d, { id: POST })],
    ["ids put", (d: ReturnType<typeof db>) => putChannelIds(commercial, d, "x", { handle: "mop" })],
  ])("commercial gets 403 on %s and no database call", async (_label, call) => {
    const database = db();
    await expect(call(database)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(database.calls).toEqual([]);
  });

  it("media_ops retry makes one retry_social_post call with its actor and answers the job", async () => {
    const database = db({ retry_social_post: () => JOB });
    expect(await retryPost(mediaOps, database, { id: POST, force: true })).toEqual({ job_id: JOB });
    expect(rpcs(database)).toEqual([
      {
        kind: "rpc",
        name: "retry_social_post",
        args: [
          {
            p_id: POST,
            p_force: true,
            p_actor: mediaOps.userId,
            p_actor_kind: "human",
            p_request_id: "req-ch",
          },
        ],
      },
    ]);
  });

  it("refreshMetrics makes one refresh_social_post_metrics call and answers 202", async () => {
    const database = db({ refresh_social_post_metrics: () => JOB });
    const response = await refreshMetrics(mediaOps, database, { id: POST });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job_id: JOB });
    expect(rpcs(database).map((call) => call.name)).toEqual(["refresh_social_post_metrics"]);
  });

  it("markWithdrawn is 403 for commercial, 403 human_only for an agent key, one call for media_ops", async () => {
    const database = db({ mark_social_post_withdrawn: () => undefined });
    await expect(markWithdrawn(commercial, database, { id: POST })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(markWithdrawn(agent, database, { id: POST })).rejects.toMatchObject({
      code: "human_only",
      status: 403,
    });
    expect(await markWithdrawn(mediaOps, database, { id: POST })).toEqual({ withdrawn: true });
    expect(rpcs(database).map((call) => call.name)).toEqual(["mark_social_post_withdrawn"]);
  });

  it("putChannelIds refuses a token field with 422 unknown_field and an agent key with human_only", async () => {
    const database = db({ put_channel_ids: () => ({ handle: "mop" }) });
    await expect(
      putChannelIds(mediaOps, database, "meta", { page_id: "1", access_token: "t" }),
    ).rejects.toMatchObject({ code: "unknown_field", status: 422 });
    await expect(putChannelIds(agent, database, "x", { handle: "mop" })).rejects.toMatchObject({
      code: "human_only",
    });
    expect(rpcs(database)).toEqual([]);
    expect(await putChannelIds(mediaOps, database, "x", { handle: "mop" })).toEqual({
      key: "x",
      value: { handle: "mop" },
    });
  });
});

describe("listPosts", () => {
  it("withdraw: true lists the rows still to delete by hand, oldest first, and not a done one", async () => {
    const posts = [
      postRow("instagram", {
        id: "b",
        status: "posted",
        withdraw_required_at: "2026-10-05T10:00:00Z",
      }),
      postRow("x", {
        id: "c",
        status: "posted",
        withdraw_required_at: "2026-10-04T10:00:00Z",
        withdrawn_at: "2026-10-04T12:00:00Z",
      }),
      postRow("x", { id: "a", status: "posted", withdraw_required_at: "2026-10-03T10:00:00Z" }),
      postRow("linkedin", { id: "d", status: "posted" }),
    ].map((row) => ({ ...row, id: `3f2a9c1d-0000-4000-8000-00000000000${row.id}` }));
    const result = await listPosts(commercial, db({}, posts), { withdraw: true, page: 1 });
    expect(result.items.map((row) => row.id.slice(-1))).toEqual(["a", "b"]);
    expect(result.total).toBe(2);
  });

  it("post_id filters to the one row of a failure mail's link", async () => {
    const other = { ...postRow("instagram"), id: "3f2a9c1d-0000-4000-8000-0000000000f9" };
    const result = await listPosts(commercial, db({}, [postRow("x"), other]), {
      post_id: POST,
      page: 1,
    });
    expect(result.items.map((row) => row.id)).toEqual([POST]);
  });
});

describe("channelHealth", () => {
  const meta = (value: Record<string, unknown>) => ({ key: "meta", value });
  const oauth = (key: string, value: Record<string, unknown>) => ({ key, value });
  const ok = { token_state: "ok", token_expires_at: "2026-12-31T00:00:00Z" };
  const levels = async (posts: ReturnType<typeof postRow>[], settings: Record<string, unknown>[]) =>
    Object.fromEntries(
      (await channelHealth(commercial, db({}, posts, settings), NOW)).map((health) => [
        health.channel,
        health.level,
      ]),
    );

  it("reports the last post, the last error and the token level per channel without a fetch", async () => {
    const posts = [
      postRow("x", {
        id: "p1",
        status: "posted",
        posted_at: "2026-10-05T14:00:00Z",
        permalink: "https://x.com/p/1",
      }),
      postRow("x", {
        id: "p2",
        status: "failed",
        error: "outcome_unknown",
        updated_at: "2026-10-06T09:00:00Z",
      }),
    ];
    const health = await channelHealth(
      commercial,
      db({}, posts, [meta({ token_state: "ok" }), oauth("x", ok), oauth("linkedin", ok)]),
      NOW,
    );
    expect(health.find((row) => row.channel === "x")).toMatchObject({
      level: "ok",
      lastPost: { at: "2026-10-05T14:00:00Z", permalink: "https://x.com/p/1" },
      lastError: { at: "2026-10-06T09:00:00Z", error: "outcome_unknown" },
    });
    expect(health.find((row) => row.channel === "instagram")).toMatchObject({
      level: "ok",
      token: { expiresAt: null, daysLeft: null },
    });
  });

  it("is red while the newest failure is token_dead, and turns back once a later post exists", async () => {
    const settings = [meta({ token_state: "ok" }), oauth("x", ok), oauth("linkedin", ok)];
    const dead = postRow("x", {
      id: "f",
      status: "failed",
      error: "token_dead",
      updated_at: "2026-10-05T10:00:00Z",
    });
    expect((await levels([dead], settings))["x"]).toBe("red");
    const later = postRow("x", { id: "p", status: "posted", posted_at: "2026-10-05T12:00:00Z" });
    expect((await levels([dead, later], settings))["x"]).toBe("ok");
  });

  it("is red for a dead token, red for Meta's missing scopes, amber for an expired LinkedIn version", async () => {
    expect(
      await levels(
        [],
        [
          meta({ token_state: "scopes_missing" }),
          oauth("x", { token_state: "dead" }),
          oauth("linkedin", { token_state: "version_expired" }),
        ],
      ),
    ).toEqual({ instagram: "red", facebook: "red", x: "red", linkedin: "amber" });
  });

  it("is connected once the channel's account ids are stored, and not before", async () => {
    const connected = async (settings: Record<string, unknown>[]) =>
      Object.fromEntries(
        (await channelHealth(commercial, db({}, [], settings), NOW)).map((health) => [
          health.channel,
          health.connected,
        ]),
      );
    expect(await connected([])).toEqual({
      instagram: false,
      facebook: false,
      x: false,
      linkedin: false,
    });
    expect(
      await connected([
        meta({ page_id: "1" }),
        oauth("x", { user_id: "7" }),
        oauth("linkedin", { organization_urn: "" }),
      ]),
    ).toEqual({ instagram: false, facebook: false, x: true, linkedin: false });
    expect(
      await connected([
        meta({ page_id: "1", ig_user_id: "2" }),
        oauth("linkedin", { organization_urn: "urn:li:organization:5" }),
      ]),
    ).toEqual({ instagram: true, facebook: true, x: false, linkedin: true });
  });
});
