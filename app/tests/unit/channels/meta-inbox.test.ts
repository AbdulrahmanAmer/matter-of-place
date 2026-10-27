// W8 item 4: Instagram comments and messages through the Meta adapter, against a fake Graph that answers the API's
// documented shapes and writes down every request. Nothing reaches the network (R50); there is no token yet (W8 6).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphError } from "../../../src/server/channels/meta.ts";
import { classifyGraphError } from "../../../src/server/channels/meta-errors.ts";
import {
  rateLimited,
  readComments,
  readMessages,
  sendReply,
} from "../../../src/server/channels/meta-inbox.ts";
import { fakeDb } from "../../fixtures/fake-db";
import { context } from "../../fixtures/asset-rows";

const IG_USER = "17841400000000001";
const PAGE = "100000000000001";
const MEDIA = "17900000000000001";
const META = { page_id: PAGE, ig_user_id: IG_USER, graph_version: "v23.0" };

interface Sent {
  method: string;
  path: string;
  params: Record<string, string>;
}

/** Answers by `<METHOD> <path>`; a call nobody registered throws. `sent` holds every request in order. */
function stubGraph(answers: Record<string, unknown>) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = new URL(input);
    const body = init.body instanceof URLSearchParams ? init.body : url.searchParams;
    const path = url.pathname.replace(/^\/v23\.0\//, "");
    sent.push({ method, path, params: Object.fromEntries(body) });
    const answer = answers[`${method} ${path}`];
    if (answer === undefined) throw new Error(`unexpected ${method} ${path}`);
    return Promise.resolve(new Response(JSON.stringify(answer)));
  });
  return sent;
}

function ctx() {
  const db = fakeDb({
    rpc: { get_vault_secret: () => "EAAtest-page-token" },
    tables: {
      settings: [
        { key: "meta", value: META, updated_at: "2026-10-07T00:00:00Z", updated_by: null },
      ],
    },
  });
  return { ...context(db, "read_social_inbox"), env: { META_APP_SECRET: "test-app-secret" } };
}

const comments = {
  data: [
    {
      id: "c1",
      text: "Which architect designed it?",
      timestamp: "2026-10-04T11:00:00+0000",
      username: "reader",
      from: { id: "9001", username: "reader" },
      replies: {
        data: [
          {
            id: "c1r1",
            text: "Thank you for asking.",
            timestamp: "2026-10-04T11:05:00+0000",
            from: { id: IG_USER, username: "matterofplace" },
          },
          {
            id: "c1r2",
            text: "Same question here.",
            timestamp: "2026-10-04T11:10:00+0000",
            username: "second",
          },
        ],
      },
    },
    { id: "c0", text: "Old one.", timestamp: "2026-10-01T09:00:00+0000", username: "early" },
  ],
};

const conversations = {
  data: [
    {
      id: "t1",
      updated_time: "2026-10-04T11:30:00+0000",
      messages: {
        data: [
          {
            id: "m2",
            message: "We can tell you more by email.",
            created_time: "2026-10-04T11:30:00+0000",
            from: { id: IG_USER, username: "matterofplace" },
          },
          {
            id: "m1",
            message: "Is it still for sale?",
            created_time: "2026-10-04T11:20:00+0000",
            from: { id: "9002", username: "buyer" },
          },
        ],
      },
    },
    { id: "t0", updated_time: "2026-09-30T08:00:00+0000" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reading comments and messages", () => {
  it("reads the comments and their replies newer than the cursor, never our own account's", async () => {
    const sent = stubGraph({ [`GET ${MEDIA}/comments`]: comments });
    const read = await readComments(ctx(), [MEDIA], new Date("2026-10-02T00:00:00Z"));
    expect(read.items).toEqual([
      {
        kind: "comment",
        graph_id: "c1",
        thread_graph_id: MEDIA,
        parent_graph_id: null,
        author_handle: "reader",
        body: "Which architect designed it?",
        received_at: "2026-10-04T11:00:00+0000",
        letters: true,
      },
      {
        kind: "comment",
        graph_id: "c1r2",
        thread_graph_id: MEDIA,
        parent_graph_id: "c1",
        author_handle: "second",
        body: "Same question here.",
        received_at: "2026-10-04T11:10:00+0000",
        letters: true,
      },
    ]);
    expect(read.newest).toBe("2026-10-04T11:10:00.000Z");
    expect(sent[0]?.params["appsecret_proof"]).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.every((request) => request.method === "GET")).toBe(true);
  });

  it("refuses an answer that is not the documented shape", async () => {
    stubGraph({ [`GET ${MEDIA}/comments`]: { data: [{ id: "c1", text: "no time" }] } });
    await expect(readComments(ctx(), [MEDIA], null)).rejects.toThrow(
      "Graph answered an unexpected shape (comments).",
    );
  });

  it("reads a conversation's messages newer than the cursor, never our own", async () => {
    const sent = stubGraph({ [`GET ${PAGE}/conversations`]: conversations });
    const read = await readMessages(ctx(), new Date("2026-10-02T00:00:00Z"));
    expect(read.items).toEqual([
      {
        kind: "message",
        graph_id: "m1",
        thread_graph_id: "t1",
        parent_graph_id: null,
        author_handle: "buyer",
        body: "Is it still for sale?",
        received_at: "2026-10-04T11:20:00+0000",
        letters: true,
      },
    ]);
    expect(sent[0]?.params["platform"]).toBe("instagram");
  });
});

/** Answers each `<METHOD> <path>` with its pages in turn (round 2: paging); `sent` holds every request in order. */
function stubPages(answers: Record<string, unknown[]>) {
  const sent: Sent[] = [];
  const served: Record<string, number> = {};
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v23\.0\//, "");
    sent.push({ method, path, params: Object.fromEntries(url.searchParams) });
    const key = `${method} ${path}`;
    const turn = served[key] ?? 0;
    served[key] = turn + 1;
    const pages = answers[key];
    if (pages === undefined) throw new Error(`unexpected ${key}`);
    // A page past those given is empty, so a read that asks too far is caught by the test's own assertions.
    return Promise.resolve(new Response(JSON.stringify(pages[turn] ?? { data: [] })));
  });
  return sent;
}

const SINCE = new Date("2026-10-02T00:00:00Z");
const comment = (id: string, timestamp: string, extra: Record<string, unknown> = {}) => ({
  id,
  text: `Comment ${id}`,
  timestamp,
  username: "reader",
  ...extra,
});
const more = (after: string) => ({
  cursors: { after },
  next: `https://graph.example/next/${after}`,
});

describe("round 2: letters and rate limits", () => {
  it("marks words without a letter, in any script, so they wake no one", async () => {
    stubPages({
      [`GET ${MEDIA}/comments`]: [
        {
          data: [
            comment("e1", "2026-10-04T11:00:00+0000", { text: "🏠✨ 👏👏" }),
            comment("a1", "2026-10-04T11:01:00+0000", { text: "¡Qué luz!" }),
            comment("a2", "2026-10-04T11:02:00+0000", { text: "بيت جميل" }),
          ],
        },
      ],
    });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(read.items.map((item) => [item.graph_id, item.letters])).toEqual([
      ["e1", false],
      ["a1", true],
      ["a2", true],
    ]);
  });

  it("takes every Graph error of class retry_at, a bare 429 and the daily limit included, as a skipped tick", () => {
    const graph = (status: number, error?: { code: number; error_subcode?: number }) =>
      new GraphError(classifyGraphError(status, error === undefined ? {} : { error }));
    const answers = [
      graph(400, { code: 4 }),
      graph(400, { code: 613 }),
      graph(429),
      graph(400, { code: 9, error_subcode: 2207042 }),
      graph(400, { code: 100 }),
      graph(400, { code: 190 }),
      graph(503),
    ];
    expect(answers.map((error) => rateLimited(error))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(rateLimited(new Error("network"))).toBe(false);
  });
});

/**
 * Round 3: answers `<METHOD> <path>` by its `after` cursor ("first" when there is none), so a read that resumes from
 * the wrong place gets the wrong page; a cursor nobody registered is an empty page (P-4682). `sent` holds every request.
 */
function stubCursors(answers: Record<string, Record<string, unknown>>) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v23\.0\//, "");
    const params = Object.fromEntries(url.searchParams);
    sent.push({ method, path, params });
    const page = answers[`${method} ${path}`]?.[params["after"] ?? "first"];
    return Promise.resolve(new Response(JSON.stringify(page ?? { data: [] })));
  });
  return sent;
}

/** Six pages of one comment each, linked by `after` cursors p2..p6; the last has no next page. */
const sixPages = (time: (n: number) => string) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [
      n === 1 ? "first" : `p${String(n)}`,
      {
        data: [comment(`c${String(n)}`, time(n))],
        ...(n === 6 ? {} : { paging: more(`p${String(n + 1)}`) }),
      },
    ]),
  );

const ids = (read: { items: { graph_id: string }[] }) => read.items.map((item) => item.graph_id);

describe("round 3: a read cut short resumes where it stopped", () => {
  it("two reads in a row reach every item of a post with more items than one read's cap", async () => {
    const sent = stubCursors({
      [`GET ${MEDIA}/comments`]: sixPages((n) => `2026-10-03T1${String(n)}:00:00+0000`),
    });
    const first = await readComments(ctx(), [MEDIA], SINCE);
    const second = await readComments(ctx(), [MEDIA], SINCE, first.pending);
    expect([...ids(first), ...ids(second)]).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(sent.map((request) => request.params["after"] ?? "first")).toEqual([
      "first",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    expect(second.pending).toEqual({});
  });

  it("reads to the end whatever the order: a page older than the cursor does not stop it", async () => {
    stubCursors({
      [`GET ${MEDIA}/comments`]: {
        first: { data: [comment("old", "2026-10-01T09:00:00+0000")], paging: more("p2") },
        p2: { data: [comment("new", "2026-10-03T09:00:00+0000")] },
      },
    });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(ids(read)).toEqual(["new"]);
  });

  it("follows a comment's nested replies past the page its comment carries", async () => {
    const sent = stubCursors({
      [`GET ${MEDIA}/comments`]: {
        first: {
          data: [
            comment("c1", "2026-10-01T11:00:00+0000", {
              replies: { data: [comment("r1", "2026-10-03T11:00:00+0000")], paging: more("r2") },
            }),
          ],
        },
      },
      "GET c1/replies": { r2: { data: [comment("r2", "2026-10-03T12:00:00+0000")] } },
    });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(read.items.map((item) => [item.graph_id, item.parent_graph_id])).toEqual([
      ["r1", "c1"],
      ["r2", "c1"],
    ]);
    expect(sent.map((request) => request.path)).toEqual([`${MEDIA}/comments`, "c1/replies"]);
    expect(read.pending).toEqual({});
  });

  it("reads a conversation's messages past the first page, over two reads when one read's cap cuts it", async () => {
    const message = (id: string) => ({
      id,
      message: `Message ${id}`,
      created_time: "2026-10-03T11:00:00+0000",
      from: { id: "9002", username: "buyer" },
    });
    const page = (n: number) => ({
      data: [message(`m${String(n)}`)],
      ...(n === 6 ? {} : { paging: more(`q${String(n + 1)}`) }),
    });
    stubCursors({
      [`GET ${PAGE}/conversations`]: {
        first: {
          data: [
            {
              id: "t1",
              updated_time: "2026-10-03T11:00:00+0000",
              messages: { data: [message("m1")], paging: more("q2") },
            },
          ],
        },
      },
      "GET t1/messages": Object.fromEntries([2, 3, 4, 5, 6].map((n) => [`q${String(n)}`, page(n)])),
    });
    const first = await readMessages(ctx(), SINCE);
    const second = await readMessages(ctx(), SINCE, first.pending);
    // The second read sees m1 again on the conversation's first page; the record keeps an id once.
    expect([...new Set([...ids(first), ...ids(second)])].sort()).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
    ]);
    expect(first.pending["t1"]).toMatchObject({ edge: "messages", after: "q6" });
    expect(second.pending).toEqual({});
  });

  it("moves the time cursor once a post is read through, never past the start of a read still open", async () => {
    stubCursors({
      [`GET ${MEDIA}/comments`]: sixPages((n) =>
        n === 6 ? "2026-10-04T12:05:00+0000" : `2026-10-03T1${String(n)}:00:00+0000`,
      ),
    });
    const first = await readComments(ctx(), [MEDIA], SINCE);
    // A quarter of an hour later the rest is read, holding a comment written after the first read began.
    const later = { ...ctx(), now: new Date("2026-10-04T12:15:00Z") };
    const second = await readComments(later, [MEDIA], SINCE, first.pending);
    expect(first).toMatchObject({ truncated: true, newest: "2026-10-03T14:00:00.000Z" });
    expect(second).toMatchObject({ truncated: false, newest: "2026-10-04T12:00:00.000Z" });
  });
});

describe("sending a reply", () => {
  const comment = { kind: "comment" as const, graph_id: "c1", thread_graph_id: MEDIA };

  it("makes no write while liveSideEffects says posting is off", async () => {
    vi.stubEnv("MOP_ENV", "preview");
    vi.stubEnv("SOCIAL_LIVE", "");
    const sent = stubGraph({ "POST c1/replies": { id: "c9" } });
    await expect(sendReply(ctx(), comment, "Thank you.")).rejects.toThrow(
      "Posting is switched off here: no write call was made.",
    );
    expect(sent).toEqual([]);
  });

  it("answers a comment under it, with the token in the body and never the address", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({ "POST c1/replies": { id: "c9" } });
    expect(await sendReply(ctx(), comment, "Thank you.")).toBe("c9");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params["message"]).toBe("Thank you.");
  });

  it("answers a message to the person in its conversation", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({
      "GET t1": {
        participants: {
          data: [
            { id: IG_USER, username: "matterofplace" },
            { id: "9002", username: "buyer" },
          ],
        },
      },
      [`POST ${PAGE}/messages`]: { recipient_id: "9002", message_id: "m9" },
    });
    const message = { kind: "message" as const, graph_id: "m1", thread_graph_id: "t1" };
    expect(await sendReply(ctx(), message, "Yes, it is.")).toBe("m9");
    expect(sent[1]?.params["recipient"]).toBe('{"id":"9002"}');
    expect(sent[1]?.params["message"]).toBe('{"text":"Yes, it is."}');
  });

  it("refuses a reply longer than Instagram takes before any call", async () => {
    vi.stubEnv("MOP_ENV", "production");
    const sent = stubGraph({});
    const message = { kind: "message" as const, graph_id: "m1", thread_graph_id: "t1" };
    await expect(sendReply(ctx(), message, "x".repeat(1001))).rejects.toThrow("1000 characters");
    expect(sent).toEqual([]);
  });
});
