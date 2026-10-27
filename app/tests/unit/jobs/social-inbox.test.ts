// W8 item 4: the two jobs of Instagram comments and messages against a fake Graph and a fake database. The read records
// each comment once by its Graph id (the fake `social_inbox_record` keeps the ids as the table's unique key does), and
// does nothing with Instagram off or no token. An approved reply is sent once, never without `liveSideEffects`, and a
// refused, failed or unknown send is recorded.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db/index.ts";
import { readSocialInbox } from "../../../src/server/jobs/system/read-social-inbox.ts";
import { sendSocialReply } from "../../../src/server/jobs/system/send-social-reply.ts";
import { fakeDb } from "../../fixtures/fake-db";
import { context } from "../../fixtures/asset-rows";

const IG_USER = "17841400000000001";
const PAGE = "100000000000001";
const MEDIA = "17900000000000001";
const META = { page_id: PAGE, ig_user_id: IG_USER, graph_version: "v23.0" };
const APPROVAL = "6a1b2c3d-0000-4000-8000-000000000001";
const INBOX = "6a1b2c3d-0000-4000-8000-000000000002";

/** Answers by `<METHOD> <path>` (a `[status, body]` pair is a refusal); every request is written down. */
function stubGraph(answers: Record<string, unknown>) {
  const sent: string[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(input).pathname.replace(/^\/v23\.0\//, "");
    sent.push(`${method} ${path}`);
    const answer = answers[`${method} ${path}`];
    if (answer === undefined) throw new Error(`unexpected ${method} ${path}`);
    if (Array.isArray(answer))
      return Promise.resolve(
        new Response(JSON.stringify(answer[1]), { status: Number(answer[0]) }),
      );
    return Promise.resolve(new Response(JSON.stringify(answer)));
  });
  return sent;
}

const comments = {
  data: [
    {
      id: "c1",
      text: "Which architect?",
      timestamp: "2026-10-04T11:00:00+0000",
      username: "reader",
    },
    { id: "c2", text: "Lovely light.", timestamp: "2026-10-04T11:10:00+0000", username: "second" },
  ],
};
const conversations = {
  data: [
    {
      id: "t1",
      updated_time: "2026-10-04T11:20:00+0000",
      messages: {
        data: [
          {
            id: "m1",
            message: "Is it still for sale?",
            created_time: "2026-10-04T11:20:00+0000",
            from: { id: "9002", username: "buyer" },
          },
        ],
      },
    },
  ],
};

const settingsRow = {
  key: "meta",
  value: META,
  updated_at: "2026-10-07T00:00:00Z",
  updated_by: null,
};

/** Instagram's row in Channels, switched on or off. */
const channelRow = (enabled: boolean) => ({
  id: "6a1b2c3d-0000-4000-8000-0000000000c1",
  channel: "instagram",
  enabled,
  approval_mode: {},
  auto_after: null,
  credentials_ref: null,
  posting_window: {},
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

/** The read's database: Instagram on or off, a token or none, and a `social_inbox_record` that keeps Graph ids. */
type CursorRow = { key: string; read_until: string; read_at: string; pending: NonNullable<Json> };

/** Round 4: a second Instagram post of ours, posted after the first. */
const MEDIA2 = "17900000000000002";

function readDb(
  options: { enabled?: boolean; token?: string; cursors?: CursorRow[]; second?: boolean } = {},
) {
  const kept = new Set<string>();
  const recorded: { key: string; ids: string[] }[] = [];
  /** The cursor each record call was asked to keep, and the lists left part way (round 3). */
  const untils: (string | undefined)[] = [];
  const pendings: Json[] = [];
  const db = fakeDb({
    rpc: {
      get_vault_secret: () => options.token ?? "EAAtest-page-token",
      social_inbox_record: (args) => {
        const items = Array.isArray(args.p_items) ? args.p_items : [];
        const ids = items.flatMap((item) =>
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          typeof item["graph_id"] === "string"
            ? [item["graph_id"]]
            : [],
        );
        recorded.push({ key: args.p_cursor_key, ids });
        untils.push(args.p_read_until);
        pendings.push(args.p_pending ?? null);
        const fresh = ids.filter((id) => !kept.has(id));
        for (const id of fresh) kept.add(id);
        return fresh.length;
      },
    },
    tables: {
      channel_settings: [channelRow(options.enabled ?? true)],
      settings: [settingsRow],
      social_inbox_cursors: options.cursors ?? [],
      social_posts: [
        {
          id: "6a1b2c3d-0000-4000-8000-0000000000d1",
          asset_id: "6a1b2c3d-0000-4000-8000-0000000000d2",
          property_id: null,
          channel: "instagram",
          status: "posted",
          scheduled_at: "2026-10-03T12:00:00Z",
          posted_at: "2026-10-03T12:00:05Z",
          remote_id: MEDIA,
          permalink: "https://www.instagram.com/p/AAA/",
          metrics: {},
          error: null,
          withdraw_required_at: null,
          withdrawn_at: null,
          created_at: "2026-10-03T12:00:00Z",
          updated_at: "2026-10-03T12:00:05Z",
        },
        ...(options.second === true
          ? [
              {
                id: "6a1b2c3d-0000-4000-8000-0000000000d3",
                asset_id: "6a1b2c3d-0000-4000-8000-0000000000d4",
                property_id: null,
                channel: "instagram",
                status: "posted",
                scheduled_at: "2026-10-03T13:00:00Z",
                posted_at: "2026-10-03T13:00:05Z",
                remote_id: MEDIA2,
                permalink: "https://www.instagram.com/p/BBB/",
                metrics: {},
                error: null,
                withdraw_required_at: null,
                withdrawn_at: null,
                created_at: "2026-10-03T13:00:00Z",
                updated_at: "2026-10-03T13:00:05Z",
              },
            ]
          : []),
      ],
    },
  });
  return { db, recorded, untils, pendings };
}

const readCtx = (db: ReturnType<typeof fakeDb>) => ({
  ...context(db, "read_social_inbox"),
  env: { META_APP_SECRET: "test-app-secret" },
});

beforeEach(() => {
  vi.stubEnv("META_PAGE_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("read_social_inbox", () => {
  it("records the new comments and messages, and a second read of the same answers records nothing", async () => {
    const sent = stubGraph({
      [`GET ${MEDIA}/comments`]: comments,
      [`GET ${PAGE}/conversations`]: conversations,
    });
    const { db, recorded } = readDb();
    const first = await readSocialInbox.run(readCtx(db), {}, {});
    expect(first).toEqual({ status: "done", result: { comments: 2, messages: 1 } });
    const second = await readSocialInbox.run(readCtx(db), {}, {});
    expect(second).toEqual({ status: "done", result: { comments: 0, messages: 0 } });
    expect(recorded[0]).toEqual({ key: "instagram_comments", ids: ["c1", "c2"] });
    expect(recorded[1]).toEqual({ key: "instagram_messages", ids: ["m1"] });
    expect(sent.every((line) => line.startsWith("GET "))).toBe(true);
  });

  it("does nothing and says why while Instagram is off", async () => {
    const sent = stubGraph({});
    const { db } = readDb({ enabled: false });
    const result = await readSocialInbox.run(readCtx(db), {}, {});
    expect(result).toEqual({ status: "done", result: { skipped: "instagram_off" } });
    expect(sent).toEqual([]);
    expect(db.calls.some((call) => call.name === "social_inbox_record")).toBe(false);
  });

  it("keeps the pages read when Graph's rate limit stops a read part way, and stores where the list stopped", async () => {
    // Round 4: the first page of comments holds c1 and c2 and names a next page, which Graph refuses with its limit.
    vi.stubGlobal("fetch", (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`${PAGE}/conversations`)) {
        return Promise.resolve(new Response(JSON.stringify(conversations)));
      }
      if (url.searchParams.get("after") === "p2") {
        const limit = { error: { message: "Application request limit", code: 4 } };
        return Promise.resolve(new Response(JSON.stringify(limit), { status: 400 }));
      }
      const next = { cursors: { after: "p2" }, next: "https://graph.example/next" };
      return Promise.resolve(new Response(JSON.stringify({ ...comments, paging: next })));
    });
    const { db, recorded, pendings } = readDb();
    const log = vi.fn();
    await expect(readSocialInbox.run({ ...readCtx(db), log }, {}, {})).resolves.toEqual({
      status: "done",
      result: { comments: 2, messages: 1, rate_limited: true },
    });
    expect(recorded).toEqual([
      { key: "instagram_comments", ids: ["c1", "c2"] },
      { key: "instagram_messages", ids: ["m1"] },
    ]);
    expect(pendings[0]).toMatchObject({ [MEDIA]: { edge: "comments", after: "p2" } });
    expect(log.mock.calls.map((call: unknown[]) => [call[1], call[2]])).toEqual([
      ["social_inbox_rate_limited", { key: "instagram_comments" }],
    ]);
  });

  it("reads a list again from its first page when its stored cursor is refused, drops a list whose node is gone, and still records the other post and the messages", async () => {
    // Round 4: Graph's paging docs say a stored cursor goes invalid as items come and go (400, code 100); a deleted
    // comment answers code 100, subcode 33.
    const refuse = (error: Record<string, unknown>) =>
      Promise.resolve(new Response(JSON.stringify({ error }), { status: 400 }));
    const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", (input: string) => {
      const url = new URL(input);
      const path = url.pathname.replace(/^\/v23\.0\//, "");
      const after = url.searchParams.get("after");
      if (path === `${MEDIA}/comments` && after === "stale") {
        return refuse({ message: "Invalid cursor", code: 100 });
      }
      if (path === `${MEDIA}/comments`) return answer({ data: comments.data.slice(0, 1) });
      if (path === `${MEDIA2}/comments`) return answer({ data: comments.data.slice(1) });
      if (path === "c9/replies") {
        return refuse({ message: "Object does not exist", code: 100, error_subcode: 33 });
      }
      if (path === `${PAGE}/conversations`) return answer(conversations);
      return answer({ data: [] });
    });
    const open = {
      thread: MEDIA,
      since: "2026-10-04T10:00:00.000Z",
      started: "2026-10-04T11:45:00Z",
    };
    const { db, recorded, pendings } = readDb({
      second: true,
      cursors: [
        {
          key: "instagram_comments",
          read_until: "2026-10-04T11:00:00Z",
          read_at: "2026-10-04T11:45:00Z",
          pending: {
            [MEDIA]: { edge: "comments", after: "stale", ...open },
            c9: { edge: "replies", after: "r2", ...open },
          },
        },
      ],
    });
    const log = vi.fn();
    await expect(readSocialInbox.run({ ...readCtx(db), log }, {}, {})).resolves.toEqual({
      status: "done",
      result: { comments: 2, messages: 1 },
    });
    expect(recorded).toEqual([
      { key: "instagram_comments", ids: ["c1", "c2"] },
      { key: "instagram_messages", ids: ["m1"] },
    ]);
    expect(pendings[0]).toEqual({});
    expect(log.mock.calls.map((call: unknown[]) => call[1])).toEqual(["social_inbox_list_gone"]);
  });

  it("records the messages when the comments read fails, then fails the run with the comments' error", async () => {
    // Round 4: comments and messages are read apart; an answer of the wrong shape is not a Graph error, so it throws.
    stubGraph({
      [`GET ${MEDIA}/comments`]: { data: [{ id: "c1", text: "no time" }] },
      [`GET ${PAGE}/conversations`]: conversations,
    });
    const { db, recorded } = readDb();
    const run = readSocialInbox.run(readCtx(db), {}, {});
    await expect(run).rejects.toThrow("Graph answered an unexpected shape (comments).");
    expect(recorded).toEqual([{ key: "instagram_messages", ids: ["m1"] }]);
  });

  it("stores where a capped read stopped, says it once, and the next tick resumes there", async () => {
    // Six pages of comments, one each, linked p2..p6 (round 3); a cursor nobody registered is an empty page.
    const page = (n: number) => ({
      data: [
        {
          id: `c${String(n)}`,
          text: "Hello",
          timestamp: "2026-10-04T11:00:00+0000",
          username: "r",
        },
      ],
      ...(n === 6
        ? {}
        : {
            paging: {
              cursors: { after: `p${String(n + 1)}` },
              next: "https://graph.example/next",
            },
          }),
    });
    const asked: string[] = [];
    vi.stubGlobal("fetch", (input: string) => {
      const url = new URL(input);
      if (!url.pathname.endsWith(`${MEDIA}/comments`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] })));
      }
      const after = url.searchParams.get("after") ?? "p1";
      asked.push(after);
      const n = Number(after.slice(1));
      return Promise.resolve(
        new Response(JSON.stringify(n >= 1 && n <= 6 ? page(n) : { data: [] })),
      );
    });
    const first = readDb();
    const log = vi.fn();
    await readSocialInbox.run({ ...readCtx(first.db), log }, {}, {});
    expect(log.mock.calls.map((call: unknown[]) => [call[1], call[2]])).toEqual([
      ["social_inbox_truncated", { key: "instagram_comments", open: 1 }],
    ]);
    const stored = first.pendings[0] ?? {};
    expect(stored).toMatchObject({ [MEDIA]: { edge: "comments", after: "p5" } });
    const second = readDb({
      cursors: [
        {
          key: "instagram_comments",
          read_until: first.untils[0] ?? "",
          read_at: "2026-10-04T12:00:00Z",
          pending: stored,
        },
      ],
    });
    await readSocialInbox.run(readCtx(second.db), {}, {});
    expect(asked).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(second.recorded[0]).toEqual({ key: "instagram_comments", ids: ["c5", "c6"] });
    expect(second.pendings[0]).toEqual({});
  });

  it("does nothing and says why with no token stored", async () => {
    const sent = stubGraph({});
    const { db } = readDb({ token: "" });
    const result = await readSocialInbox.run(readCtx(db), {}, {});
    expect(result).toEqual({ status: "done", result: { skipped: "no_token" } });
    expect(sent).toEqual([]);
  });
});

/** The send's database: what `social_inbox_reply_begin` answers in turn, and every outcome recorded. */
/** The inbox row of an approved reply not yet begun (round 3: what the send reads while Instagram is off). */
const unsentRow = {
  id: INBOX,
  channel: "instagram",
  kind: "comment",
  graph_id: "c1",
  thread_graph_id: MEDIA,
  parent_graph_id: null,
  social_post_id: null,
  author_handle: "reader",
  body: "Which architect?",
  received_at: "2026-10-04T11:00:00Z",
  state: "proposed",
  approval_id: APPROVAL,
  reply_state: null,
  reply_graph_id: null,
  reply_error: null,
  replied_at: null,
  created_at: "2026-10-04T11:00:00Z",
  updated_at: "2026-10-04T11:00:00Z",
};

function sendDb(answers: Json[], options: { enabled?: boolean; unsent?: boolean } = {}) {
  const outcomes: { outcome: string; reply?: string | undefined; error?: string | undefined }[] =
    [];
  let call = 0;
  const db = fakeDb({
    rpc: {
      get_vault_secret: () => "EAAtest-page-token",
      social_inbox_reply_begin: () => {
        const answer = answers[Math.min(call, answers.length - 1)] ?? null;
        call += 1;
        return answer;
      },
      social_inbox_reply_result: (args) => {
        outcomes.push({
          outcome: args.p_outcome,
          reply: args.p_reply_graph_id,
          error: args.p_error,
        });
        return undefined;
      },
    },
    tables: {
      settings: [settingsRow],
      channel_settings: [channelRow(options.enabled ?? true)],
      // The rows the query is meant to return: this approval's row while its reply is not begun, else none.
      social_inbox: options.unsent === false ? [] : [unsentRow],
    },
  });
  return { db, outcomes };
}

const begin = {
  state: "send",
  inbox_id: INBOX,
  kind: "comment",
  graph_id: "c1",
  thread_graph_id: MEDIA,
  body: "Thank you for asking.",
};
const sendCtx = (db: ReturnType<typeof fakeDb>) => ({
  ...context(db, "send_social_reply"),
  env: { META_APP_SECRET: "test-app-secret" },
});
const data = { approval_id: APPROVAL };

describe("send_social_reply", () => {
  it("sends an approved reply once: a rerun finds it sent and makes no call", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({ "POST c1/replies": { id: "c9" } });
    const { db, outcomes } = sendDb([begin, { state: "sent", inbox_id: INBOX }]);
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { sent: "c9" },
    });
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { skipped: "sent" },
    });
    expect(sent).toEqual(["POST c1/replies"]);
    expect(outcomes).toEqual([{ outcome: "sent", reply: "c9", error: undefined }]);
  });

  it("writes nothing while liveSideEffects says posting is off, and records the refusal", async () => {
    vi.stubEnv("MOP_ENV", "preview");
    vi.stubEnv("SOCIAL_LIVE", "");
    const sent = stubGraph({});
    const { db, outcomes } = sendDb([begin]);
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { refused: "not_live" },
    });
    expect(sent).toEqual([]);
    expect(outcomes.map((row) => row.outcome)).toEqual(["refused"]);
  });

  it("records Graph's refusal as failed, with its reason", async () => {
    vi.stubEnv("MOP_ENV", "production");
    stubGraph({
      "POST c1/replies": [400, { error: { message: "Comment is deleted", code: 100 } }],
    });
    const { db, outcomes } = sendDb([begin]);
    await sendSocialReply.run(sendCtx(db), {}, data);
    expect(outcomes[0]?.outcome).toBe("failed");
    expect(outcomes[0]?.error).toContain("Comment is deleted");
  });

  it("writes nothing while Instagram is switched off in Channels, and records the refusal in fixed words", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({});
    const { db, outcomes } = sendDb([begin], { enabled: false });
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { refused: "instagram_off" },
    });
    expect(sent).toEqual([]);
    expect(outcomes).toEqual([
      {
        outcome: "refused",
        reply: undefined,
        error: "Instagram is switched off in Channels: no write was made.",
      },
    ]);
  });

  it("reads the switch before begin: a reply refused while Instagram is off is never marked sending", async () => {
    vi.stubEnv("MOP_ENV", "production");
    stubGraph({});
    const off = sendDb([begin], { enabled: false });
    await sendSocialReply.run(sendCtx(off.db), {}, data);
    expect(off.db.calls.filter((call) => call.kind === "rpc").map((call) => call.name)).toEqual([
      "social_inbox_reply_result",
    ]);
    // A reply already begun goes on to begin, which answers the state it reached.
    const since = new Date(Date.parse("2026-10-04T12:00:00Z") - 10 * 60 * 1000).toISOString();
    const begun = sendDb([{ state: "sending", inbox_id: INBOX, since }], {
      enabled: false,
      unsent: false,
    });
    await sendSocialReply.run(sendCtx(begun.db), {}, data);
    expect(begun.outcomes.map((row) => row.outcome)).toEqual(["unknown"]);
  });

  it("records begin's refusal (no person, or the 24-hour window) with its words and makes no call", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({});
    const reason = "The 24-hour reply window closed: no write was made.";
    const { db, outcomes } = sendDb([{ state: "refuse", inbox_id: INBOX, reason }]);
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { refused: reason },
    });
    expect(sent).toEqual([]);
    expect(outcomes).toEqual([{ outcome: "refused", reply: undefined, error: reason }]);
  });

  it("records a 5xx or transient answer to the write as unknown, never failed", async () => {
    vi.stubEnv("MOP_ENV", "production");
    stubGraph({ "POST c1/replies": [503, { error: { message: "Service unavailable", code: 2 } }] });
    const first = sendDb([begin]);
    await sendSocialReply.run(sendCtx(first.db), {}, data);
    stubGraph({
      "POST c1/replies": [400, { error: { message: "Try later", code: 99, is_transient: true } }],
    });
    const second = sendDb([begin]);
    await sendSocialReply.run(sendCtx(second.db), {}, data);
    expect([first.outcomes[0]?.outcome, second.outcomes[0]?.outcome]).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("asks again after the lease when a rerun finds a send begun under five minutes ago", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({});
    const ctx = sendCtx(sendDb([]).db);
    const since = new Date(ctx.now.getTime() - 60 * 1000).toISOString();
    const { db, outcomes } = sendDb([{ state: "sending", inbox_id: INBOX, since }]);
    const result = await sendSocialReply.run(sendCtx(db), {}, data);
    expect(result).toMatchObject({
      status: "retry_at",
      at: new Date(Date.parse(since) + 5 * 60 * 1000),
    });
    expect(outcomes).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("records a send that began and never came back as unknown, and never sends it again", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({});
    const { db, outcomes } = sendDb([{ state: "sending", inbox_id: INBOX }]);
    expect(await sendSocialReply.run(sendCtx(db), {}, data)).toEqual({
      status: "done",
      result: { skipped: "sending" },
    });
    expect(sent).toEqual([]);
    expect(outcomes.map((row) => row.outcome)).toEqual(["unknown"]);
  });
});
