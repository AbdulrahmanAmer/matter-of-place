// B11 step 8: scripts/newsletter-test-send.ts, the live modes. The database connection, the production guard, the dev
// lock and the sleep are stubs, so no connection is opened and nothing is sent (R50); the cases prove what the script
// asks the database, in which order, and that the connection and the lock are given back on every path.
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertNotProduction } from "../../../scripts/lib/assert-not-production.mjs";
import { newsletterTestSendMain } from "../../../scripts/newsletter-test-send";
import { holdDevLock } from "../../fixtures/dev-lock";

type Params = readonly unknown[] | undefined;
type Answer = (sql: string, params: Params) => unknown[];

const db = vi.hoisted(
  (): { queries: { sql: string; params: Params }[]; events: string[]; answer: Answer } => ({
    queries: [],
    events: [],
    answer: () => [],
  }),
);

vi.mock("pg", () => ({
  default: {
    Client: class {
      connect(): Promise<void> {
        db.events.push("connect");
        return Promise.resolve();
      }
      query(sql: string, params?: Params): Promise<{ rows: unknown[] }> {
        db.queries.push({ sql, params });
        return Promise.resolve({ rows: db.answer(sql, params) });
      }
      end(): Promise<void> {
        db.events.push("end");
        return Promise.resolve();
      }
    },
  },
}));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));
vi.mock("../../../scripts/lib/guard-env.mjs", () => ({ guardEnv: vi.fn() }));
vi.mock("../../../scripts/lib/assert-not-production.mjs", () => ({ assertNotProduction: vi.fn() }));
vi.mock("../../fixtures/dev-lock", () => ({ holdDevLock: vi.fn() }));

const ISSUE = "11111111-1111-4111-8111-111111111111";
const STORY = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const STORY_BLOCK = { id: `story:${STORY}`, type: "story", story_id: STORY, title: "T", deck: "D" };

let lines: string[];
let released: boolean;

const ran = (fragment: string) => db.queries.filter((query) => query.sql.includes(fragment));

/** Answers by the first fragment of the SQL that matches; an unlisted query fails the case. */
function answers(table: Record<string, unknown[] | Answer>): void {
  db.answer = (sql, params) => {
    const key = Object.keys(table).find((fragment) => sql.includes(fragment));
    if (key === undefined) throw new Error(`unexpected query: ${sql}`);
    const rows = table[key];
    return rows === undefined ? [] : typeof rows === "function" ? rows(sql, params) : rows;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.queries = [];
  db.events = [];
  lines = [];
  released = false;
  vi.stubEnv("DEV_DB_URL", "postgresql://postgres:secret@127.0.0.1:5432/postgres");
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(line));
  vi.mocked(holdDevLock).mockResolvedValue(() => {
    released = true;
    db.events.push("release");
    return Promise.resolve();
  });
});

describe("newsletter-test-send --make-draft", () => {
  it("refuses without --i-mean-it and opens nothing", async () => {
    expect(await newsletterTestSendMain(["--make-draft"])).toBe(1);
    expect(lines).toEqual(["refused: --i-mean-it required"]);
    expect(assertNotProduction).not.toHaveBeenCalled();
    expect(db.events).toEqual([]);
  });

  it("saves one story block for the newest published story and prints the draft", async () => {
    answers({
      newsletter_open_draft: [{ id: ISSUE, number: 5, blocks: [] }],
      "from public.stories": [{ id: STORY, title: "T", deck: "D" }],
      newsletter_save_draft: [{ saved: { id: ISSUE, number: 5 } }],
    });
    expect(await newsletterTestSendMain(["--make-draft", "--i-mean-it"])).toBe(0);
    expect(lines).toEqual([`draft ${ISSUE}`]);
    const saved = ran("newsletter_save_draft")[0];
    expect(JSON.parse(String(saved?.params?.[0]))).toEqual([STORY_BLOCK]);
    expect(saved?.params?.[1]).toBe("Place Notes No. 5: T");
    expect(ran("from public.stories")[0]?.sql).toContain("order by published_at desc limit 1");
  });

  it("leaves a draft that already has blocks alone", async () => {
    answers({ newsletter_open_draft: [{ id: ISSUE, number: 5, blocks: [STORY_BLOCK] }] });
    expect(await newsletterTestSendMain(["--make-draft", "--i-mean-it"])).toBe(0);
    expect(lines).toEqual([`draft ${ISSUE}`]);
    expect(ran("newsletter_save_draft")).toEqual([]);
  });

  it("exits 1 with no published story and saves nothing", async () => {
    answers({
      newsletter_open_draft: [{ id: ISSUE, number: 5, blocks: [] }],
      "from public.stories": [],
    });
    expect(await newsletterTestSendMain(["--make-draft", "--i-mean-it"])).toBe(1);
    expect(lines).toEqual(["no published story"]);
    expect(ran("newsletter_save_draft")).toEqual([]);
  });

  it("refuses after the launch switch before it connects", async () => {
    vi.mocked(assertNotProduction).mockRejectedValue(new Error("refusing: production database"));
    await expect(newsletterTestSendMain(["--make-draft", "--i-mean-it"])).rejects.toThrow(
      "refusing: production database",
    );
    expect(db.events).toEqual([]);
    expect(holdDevLock).not.toHaveBeenCalled();
  });
});

describe("newsletter-test-send --to", () => {
  const sendAnswers = (status: string, confirmed = true) => ({
    "from auth.users": [{ id: ACTOR }],
    "status = 'draft'": [{ id: ISSUE, number: 5, blocks: [STORY_BLOCK] }],
    "insert into public.subscribers": [],
    confirm_subscriber: [{ id: confirmed ? "sub" : null }],
    newsletter_approve_issue: [],
    "from public.newsletter_issues": [
      { status, resend_broadcast_id: status === "sent" ? "bc_1" : null, send_error: null },
    ],
    begin: [],
    commit: [],
    rollback: [],
  });

  it("refuses without --i-mean-it or without --actor", async () => {
    expect(await newsletterTestSendMain(["--to", "a@x.test"])).toBe(1);
    expect(await newsletterTestSendMain(["--to", "a@x.test", "--i-mean-it"])).toBe(1);
    expect(lines).toEqual([
      "refused: --i-mean-it required",
      "refused: --actor <staff email> required",
    ]);
    expect(db.events).toEqual([]);
  });

  it("confirms each address as a test subscriber, approves for now and prints the broadcast", async () => {
    answers(sendAnswers("sent"));
    const argv = ["--to", "A@x.test, b@x.test", "--actor", "Op@x.test", "--i-mean-it"];
    expect(await newsletterTestSendMain(argv)).toBe(0);
    expect(lines).toEqual(["sent bc_1"]);
    const inserts = ran("insert into public.subscribers");
    expect(inserts.map((query) => query.params?.[0])).toEqual(["a@x.test", "b@x.test"]);
    expect(inserts.map((query) => query.params?.[2])).toEqual(["test", "test"]);
    const hashes = inserts.map((query) => query.params?.[1]);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(ran("confirm_subscriber").map((query) => query.params?.[0])).toEqual(hashes);
    expect(ran("newsletter_approve_issue")[0]?.sql).toContain("($1, null, $2, 'human', $3)");
    expect(ran("newsletter_approve_issue")[0]?.params?.slice(0, 2)).toEqual([ISSUE, ACTOR]);
    expect(ran("from auth.users")[0]?.params).toEqual(["Op@x.test"]);
    expect(db.events).toEqual(["connect", "end", "release"]);
    expect(released).toBe(true);
  });

  it("approves only after the subscribers are confirmed", async () => {
    answers(sendAnswers("sent"));
    await newsletterTestSendMain(["--to", "a@x.test", "--actor", "op@x.test", "--i-mean-it"]);
    const order = db.queries.map((query) => query.sql);
    const at = (fragment: string) => order.findIndex((sql) => sql.includes(fragment));
    expect(at("confirm_subscriber")).toBeGreaterThan(-1);
    expect(at("commit")).toBeGreaterThan(at("confirm_subscriber"));
    expect(at("newsletter_approve_issue")).toBeGreaterThan(at("commit"));
  });

  it("prints the status and exits 1 when the issue is not sent within five minutes", async () => {
    answers(sendAnswers("sending"));
    const argv = ["--to", "a@x.test", "--actor", "op@x.test", "--i-mean-it"];
    expect(await newsletterTestSendMain(argv)).toBe(1);
    expect(lines).toEqual(["sending"]);
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(61);
    expect(db.events.at(-1)).toBe("release");
  });

  it("refuses an actor that is not a human staff user before it writes", async () => {
    answers({ ...sendAnswers("sent"), "from auth.users": [] });
    const argv = ["--to", "a@x.test", "--actor", "who@x.test", "--i-mean-it"];
    expect(await newsletterTestSendMain(argv)).toBe(1);
    expect(lines).toEqual(["refused: no human staff user who@x.test"]);
    expect(ran("insert into public.subscribers")).toEqual([]);
  });

  it("refuses when the draft has no blocks and writes nothing", async () => {
    answers({
      ...sendAnswers("sent"),
      "status = 'draft'": [{ id: ISSUE, number: 5, blocks: [] }],
    });
    const argv = ["--to", "a@x.test", "--actor", "op@x.test", "--i-mean-it"];
    expect(await newsletterTestSendMain(argv)).toBe(1);
    expect(lines).toEqual(["refused: no draft with blocks (run --make-draft first)"]);
    expect(ran("insert into public.subscribers")).toEqual([]);
  });

  it("rolls back and approves nothing when an address does not confirm", async () => {
    answers(sendAnswers("sent", false));
    const argv = ["--to", "a@x.test", "--actor", "op@x.test", "--i-mean-it"];
    await expect(newsletterTestSendMain(argv)).rejects.toThrow("could not confirm a@x.test");
    expect(ran("rollback")).toHaveLength(1);
    expect(ran("newsletter_approve_issue")).toEqual([]);
    expect(db.events).toEqual(["connect", "end", "release"]);
  });

  it("refuses after the launch switch before it connects", async () => {
    vi.mocked(assertNotProduction).mockRejectedValue(new Error("refusing: production database"));
    const argv = ["--to", "a@x.test", "--actor", "op@x.test", "--i-mean-it"];
    await expect(newsletterTestSendMain(argv)).rejects.toThrow("refusing: production database");
    expect(db.events).toEqual([]);
  });
});
