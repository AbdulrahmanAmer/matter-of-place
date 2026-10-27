// W8 item 4: Instagram comments and messages through the Meta adapter, against a fake Graph that answers the API's
// documented shapes and writes down every request. Nothing reaches the network (R50); there is no token yet (W8 6).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphError } from "../../../src/server/channels/meta.ts";
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

describe("round 2: paging, caps and rate limits", () => {
  it("stops at the first page that reaches the cursor and moves it to the newest time read", async () => {
    const sent = stubPages({
      [`GET ${MEDIA}/comments`]: [
        {
          data: [
            comment("n1", "2026-10-04T11:00:00+0000"),
            comment("o1", "2026-10-01T11:00:00+0000"),
          ],
          paging: more("p2"),
        },
      ],
    });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(sent).toHaveLength(1);
    expect(read.items.map((item) => item.graph_id)).toEqual(["n1"]);
    expect(read).toMatchObject({ truncated: false, newest: "2026-10-04T11:00:00.000Z" });
  });

  it("holds the cursor when the page cap is hit with newer comments unread", async () => {
    const page = (n: number) => ({
      data: [comment(`c${String(n)}`, `2026-10-0${String(9 - n)}T11:00:00+0000`)],
      paging: more(`p${String(n + 1)}`),
    });
    const sent = stubPages({ [`GET ${MEDIA}/comments`]: [page(1), page(2), page(3), page(4)] });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(sent.map((request) => request.params["after"] ?? "first")).toEqual([
      "first",
      "p2",
      "p3",
      "p4",
    ]);
    expect(read.items).toHaveLength(4);
    expect(read).toMatchObject({ truncated: true, newest: SINCE.toISOString() });
  });

  it("holds the cursor when a comment's nested replies have more, all newer than it", async () => {
    stubPages({
      [`GET ${MEDIA}/comments`]: [
        {
          data: [
            comment("c1", "2026-10-03T11:00:00+0000", {
              replies: {
                data: [comment("r1", "2026-10-04T11:00:00+0000")],
                paging: more("r2"),
              },
            }),
          ],
        },
      ],
    });
    const read = await readComments(ctx(), [MEDIA], SINCE);
    expect(read.items.map((item) => item.graph_id)).toEqual(["c1", "r1"]);
    expect(read).toMatchObject({ truncated: true, newest: SINCE.toISOString() });
  });

  it("pages the conversations to the cursor and holds it when a conversation's messages have more", async () => {
    const message = (id: string, time: string) => ({
      id,
      message: `Message ${id}`,
      created_time: time,
      from: { id: "9002", username: "buyer" },
    });
    const sent = stubPages({
      [`GET ${PAGE}/conversations`]: [
        {
          data: [
            {
              id: "t1",
              updated_time: "2026-10-04T11:00:00+0000",
              messages: {
                data: [message("m2", "2026-10-04T11:00:00+0000")],
                paging: more("m1"),
              },
            },
          ],
          paging: more("t2"),
        },
        {
          data: [{ id: "t2", updated_time: "2026-10-01T09:00:00+0000" }],
          paging: more("t3"),
        },
      ],
    });
    const read = await readMessages(ctx(), SINCE);
    expect(sent.map((request) => request.params["after"] ?? "first")).toEqual(["first", "t2"]);
    expect(read.items.map((item) => item.graph_id)).toEqual(["m2"]);
    expect(read).toMatchObject({ truncated: true, newest: SINCE.toISOString() });
  });

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

  it("names Graph's rate-limit codes and nothing else as a skipped tick", () => {
    const graph = (code: number) =>
      new GraphError({ class: "retry_at", code, subcode: null, message: "limit" });
    expect([4, 17, 32, 613, 100, 190].map((code) => rateLimited(graph(code)))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(rateLimited(new Error("network"))).toBe(false);
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
