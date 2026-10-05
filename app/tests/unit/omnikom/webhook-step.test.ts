// B15 step 4: the webhook_omnikom step with B3's fakeDb for mark_inquiry_forwarded, its reads answered from a `World`
// (inquiry, property, representative), and a fetch spy standing in for Omnikom's endpoint.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db";
import type { InquiryRow } from "../../../src/domain/rows";
import { webhookOmnikom } from "../../../src/server/jobs/steps/webhook-omnikom";
import {
  NonRetryableError,
  type RunnerEnv,
  type StepContext,
} from "../../../src/server/jobs/types";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T10:00:00.000Z");
const MINUTE_MS = 60_000;
const INQUIRY_ID = "2aad04a4-3848-43fc-b90e-1db79b89f5ac";
/** UUID v5 of INQUIRY_ID in OMNIKOM_NS, made with node:crypto's SHA-1, not with the code under test. */
const DELIVERY_ID = "73b49cbb-58d6-5523-ac41-4f6669fef9d5";
const SECRET = "sekret-test";
const URL_OMNIKOM = "https://omnikom.test/hooks/mop";
const ENV: RunnerEnv = { OMNIKOM_WEBHOOK_URL: URL_OMNIKOM, OMNIKOM_WEBHOOK_SECRET: SECRET };

const inquiryRow = (fields: Partial<InquiryRow> = {}): InquiryRow => ({
  id: INQUIRY_ID,
  intent: "showing",
  topic: "About a property",
  subject_kind: "property",
  subject_slug: "sea-ranch-house",
  subject_title: "Sea Ranch House",
  name: "Ada Reyes",
  email: "ada@example.com",
  phone: "+1 415 555 0100",
  location: "San Francisco",
  message: "Could we see the house on Saturday?",
  details: { timing: "This month" },
  source_path: "/property/sea-ranch-house",
  state: "new",
  forwarded_at: null,
  received_at: "2026-10-04T09:30:00.000+00:00",
  ip_hash: "ip-hash-value-7f3a",
  assigned_to: null,
  forwarded_payload: null,
  turnstile_ok: true,
  anonymised_at: null,
  attribution: { pages_viewed: 2 },
  ...fields,
});

interface World {
  inquiry: InquiryRow | null;
  property: {
    slug: string;
    title: string;
    market_slug: string;
    city: string;
    campaign_tier: "Feature";
    presented_by_owner: boolean;
    representative_id: string | null;
  };
  mark: () => boolean | Error;
}

const world = (fields: Partial<World> = {}): World => ({
  inquiry: inquiryRow(),
  property: {
    slug: "sea-ranch-house",
    title: "Sea Ranch House",
    market_slug: "california",
    city: "The Sea Ranch",
    campaign_tier: "Feature",
    presented_by_owner: false,
    representative_id: "5e2c1a90-0000-4000-8000-000000000003",
  },
  mark: () => true,
  ...fields,
});

interface Query extends Promise<{ data: unknown[]; error: null }> {
  eq: () => Query;
}

/** fakeDb for the RPC; the three reads answer from `w` at call time, and any write method is missing. */
function dbOf(w: World): FakeDb {
  const db = fakeDb({ rpc: { mark_inquiry_forwarded: () => w.mark() } });
  const tables: Record<string, () => unknown[]> = {
    inquiries: () => (w.inquiry === null ? [] : [w.inquiry]),
    properties: () => [w.property],
    representatives: () => [{ name: "Maya Lin", brokerage: "Coastal Partners" }],
  };
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      const rows = tables[name];
      if (rows === undefined) throw new Error(`unexpected table ${name}`);
      const query = (): Query =>
        Object.assign(Promise.resolve({ data: rows(), error: null }), { eq: query });
      return { select: query };
    },
  });
}

const rpcCalls = (db: FakeDb) => db.calls.filter((call) => call.kind !== "from");

type Sent = { headers: Headers; body: string };

/** A fake Omnikom endpoint: records each request and answers with `answer(request)`. */
function omnikom(answer: (sent: Sent) => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    const request = {
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : "",
    };
    sent.push(request);
    return answer(request);
  });
  return sent;
}

const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(code === 422 ? "missing field: email" : null, { status: code, headers });

interface Run {
  result?: Json | null;
  now?: Date;
  env?: RunnerEnv;
  jobId?: string;
  data?: Record<string, Json>;
}

const logs: string[] = [];

function run(db: FakeDb, { result = null, now = NOW, env = ENV, jobId, data }: Run = {}) {
  const ctx: StepContext = {
    db,
    env,
    log: (level, event, fields) => {
      logs.push(JSON.stringify({ level, event, ...fields }));
    },
    now,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: jobId ?? "3f2a9c1d-0000-4000-8000-000000000001",
      type: "webhook_omnikom",
      attempts: 1,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result,
      eventId: null,
    },
  };
  return webhookOmnikom.run(ctx, {}, data ?? { inquiry_id: INQUIRY_ID });
}

/** How a run ended when it threw: dead (NonRetryableError) or a plain error B8 retries, and the message. */
async function thrown(pending: Promise<unknown>): Promise<{ dead: boolean; message: string }> {
  try {
    await pending;
  } catch (error) {
    return {
      dead: error instanceof NonRetryableError,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { dead: false, message: "resolved" };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  logs.length = 0;
});

describe("webhook_omnikom", () => {
  it("a 2xx marks the inquiry forwarded once with the body it sent, and the done result keeps no body", async () => {
    const db = dbOf(world());
    const sent = omnikom(status(202));
    const result = await run(db);
    const body: unknown = JSON.parse(sent[0]?.body ?? "");
    expect(rpcCalls(db)).toEqual([
      {
        kind: "rpc",
        name: "mark_inquiry_forwarded",
        args: [{ p_inquiry_id: INQUIRY_ID, p_payload: body }],
      },
    ]);
    expect(result).toEqual({
      status: "done",
      result: { delivery_id: DELIVERY_ID, delivery_attempts: 1, last_http_status: 202 },
    });
  });

  it("a 409 counts as delivered and makes the same one call", async () => {
    const db = dbOf(world());
    omnikom(status(409));
    const result = await run(db);
    expect(rpcCalls(db).map((call) => call.name)).toEqual(["mark_inquiry_forwarded"]);
    expect(result.status).toBe("done");
  });

  it("the body carries the subject property and its representative", async () => {
    const sent = omnikom(status(202));
    await run(dbOf(world()));
    const body: unknown = JSON.parse(sent[0]?.body ?? "");
    expect(body).toHaveProperty("data.subject", {
      kind: "property",
      slug: "sea-ranch-house",
      title: "Sea Ranch House",
      market: "california",
      city: "The Sea Ranch",
      tier: "Feature",
      presented_by: "agent",
      representation: { name: "Maya Lin", brokerage: "Coastal Partners" },
    });
  });

  it("mark_inquiry_forwarded answering false throws inquiry_gone", async () => {
    omnikom(status(202));
    const out = await thrown(run(dbOf(world({ mark: () => false }))));
    expect(out).toEqual({ dead: true, message: "inquiry_gone" });
  });

  it("an RPC error throws a plain Error, which B8 retries under its own backoff", async () => {
    omnikom(status(202));
    const failure = Object.assign(new Error("connection reset"), { code: "08006" });
    const out = await thrown(run(dbOf(world({ mark: () => failure }))));
    expect(out).toEqual({ dead: false, message: "mark_inquiry_forwarded_failed:08006" });
  });

  it("invariant 3: a 503 returns retry_at one minute on, stores the body and writes nothing", async () => {
    const db = dbOf(world());
    const sent = omnikom(status(503));
    const result = await run(db);
    const at = new Date(NOW.getTime() + MINUTE_MS);
    expect(result).toEqual({
      status: "retry_at",
      at,
      reason: "omnikom_unavailable",
      result: {
        delivery_id: DELIVERY_ID,
        delivery_attempts: 1,
        last_http_status: 503,
        next_at: at.toISOString(),
        body: sent[0]?.body,
      },
    });
    expect(rpcCalls(db)).toEqual([]);
  });

  it("invariant 2: two retry_at runs send one delivery id and the same body bytes with a new timestamp", async () => {
    const w = world();
    const sent = omnikom(status(503));
    const first = await run(dbOf(w));
    w.property.title = "Sea Ranch House, renamed";
    const later = new Date(NOW.getTime() + 2 * MINUTE_MS);
    const second = await run(dbOf(w), { result: first.result ?? null, now: later });
    const [one, two] = sent;
    expect(two?.body).toBe(one?.body);
    expect(second.result).toHaveProperty("body", one?.body);
    expect(second.result).toHaveProperty("delivery_attempts", 2);
    expect([one?.headers.get("x-mop-delivery-id"), two?.headers.get("x-mop-delivery-id")]).toEqual([
      DELIVERY_ID,
      DELIVERY_ID,
    ]);
    expect(two?.headers.get("x-mop-timestamp")).toBe(String(later.getTime() / 1000));
    expect(two?.headers.get("x-mop-signature")).not.toBe(one?.headers.get("x-mop-signature"));
  });

  it("a manual job for the same inquiry sends the same delivery id", async () => {
    const sent = omnikom(status(202));
    await run(dbOf(world()), { jobId: "9c4b2e17-0000-4000-8000-000000000004" });
    expect(sent[0]?.headers.get("x-mop-delivery-id")).toBe(DELIVERY_ID);
    expect(JSON.parse(sent[0]?.body ?? "")).toHaveProperty("id", DELIVERY_ID);
  });

  it("webhook_omnikom runs twice without a second outside effect", async () => {
    const received = new Set<string>();
    omnikom(({ headers }) => {
      const id = headers.get("x-mop-delivery-id") ?? "";
      if (received.has(id)) return new Response(null, { status: 409 });
      received.add(id);
      return new Response(null, { status: 202 });
    });
    const first = await run(dbOf(world()));
    const again = await run(dbOf(world()), { jobId: "9c4b2e17-0000-4000-8000-000000000004" });
    expect([first.status, again.status]).toEqual(["done", "done"]);
    expect(received.size).toBe(1);
  });

  it("invariant 3b: a 422 throws omnikom_refused:422 with the answer and changes nothing", async () => {
    const db = dbOf(world());
    omnikom(status(422));
    const out = await thrown(run(db));
    expect(out).toEqual({ dead: true, message: "omnikom_refused:422 missing field: email" });
    expect(rpcCalls(db)).toEqual([]);
  });

  it("invariant 3b: an anonymised or missing row throws inquiry_gone before any call", async () => {
    const sent = omnikom(status(202));
    const anonymised = world({ inquiry: inquiryRow({ anonymised_at: NOW.toISOString() }) });
    const stored = { delivery_attempts: 2, body: "{}" };
    expect(await thrown(run(dbOf(anonymised), { result: stored }))).toEqual({
      dead: true,
      message: "inquiry_gone",
    });
    expect(await thrown(run(dbOf(world({ inquiry: null }))))).toEqual({
      dead: true,
      message: "inquiry_gone",
    });
    expect(sent).toEqual([]);
  });

  it("with no OMNIKOM_WEBHOOK_URL the step skips and forwards nothing", async () => {
    const db = dbOf(world());
    const sent = omnikom(status(202));
    const result = await run(db, { env: {} });
    expect(result).toEqual({ status: "done", result: { skipped: "not_configured" } });
    expect({ sent: sent.length, db: db.calls.length }).toEqual({ sent: 0, db: 0 });
  });

  it("a URL without a secret, a malformed URL or a job without an inquiry id is dead at once", async () => {
    const sent = omnikom(status(202));
    const outcomes = await Promise.all([
      thrown(run(dbOf(world()), { env: { OMNIKOM_WEBHOOK_URL: URL_OMNIKOM } })),
      thrown(run(dbOf(world()), { env: { ...ENV, OMNIKOM_WEBHOOK_URL: "omnikom hooks" } })),
      thrown(run(dbOf(world()), { data: {} })),
    ]);
    expect(outcomes).toEqual([
      { dead: true, message: "omnikom_secret_missing" },
      { dead: true, message: "omnikom_url_invalid" },
      { dead: true, message: "inquiry_id_missing" },
    ]);
    expect(sent).toEqual([]);
  });

  it("invariant 3: the seventh failure throws omnikom_unreachable and changes nothing", async () => {
    const db = dbOf(world());
    omnikom(status(503));
    const out = await thrown(run(db, { result: { delivery_attempts: 6 } }));
    expect(out).toEqual({ dead: true, message: "omnikom_unreachable" });
    expect(rpcCalls(db)).toEqual([]);
  });

  it("invariant 3: a network error retries with one more delivery attempt", async () => {
    omnikom(() => Promise.reject(new TypeError("fetch failed")));
    const result = await run(dbOf(world()), { result: { delivery_attempts: 2 } });
    expect(result.status).toBe("retry_at");
    expect(result.result).toHaveProperty("delivery_attempts", 3);
  });

  it("invariant 3: a fetch that never answers is aborted at 10 seconds and retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // P-080: fake timers do not drive Node's AbortSignal.timeout, so the timeout signal comes from a faked setTimeout.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, ms);
      return controller.signal;
    });
    let reached = (): void => undefined;
    const fetched = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
          reached();
        }),
    );
    const pending = run(dbOf(world()), { result: { delivery_attempts: 2 } });
    await fetched;
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.status).toBe("retry_at");
    expect(result.result).toHaveProperty("delivery_attempts", 3);
  });

  it("invariant 3: 408, 425 and 429 each return retry_at", async () => {
    const ends: string[] = [];
    for (const code of [408, 425, 429]) {
      omnikom(status(code));
      ends.push((await run(dbOf(world()))).status);
    }
    expect(ends).toEqual(["retry_at", "retry_at", "retry_at"]);
  });

  it("invariant 3: a Retry-After later than the ladder wins", async () => {
    omnikom(status(429, { "retry-after": "7200" }));
    const result = await run(dbOf(world()));
    expect(result).toHaveProperty("at", new Date(NOW.getTime() + 7200 * 1000));
  });

  it("invariant 7: no secret and no signature header in the forwarded payload, the results or the log", async () => {
    const answers = [503, 202];
    const sent = omnikom(() => new Response(null, { status: answers.shift() ?? 500 }));
    const db = dbOf(world());
    const retry = await run(db);
    const done = await run(db, { result: retry.result ?? null });
    expect(sent).toHaveLength(2);
    const written = [
      JSON.stringify(rpcCalls(db)),
      JSON.stringify(retry.result),
      JSON.stringify(done.result),
      ...logs,
    ];
    expect(
      written.filter((text) => text.includes(SECRET) || /x-mop-signature/i.test(text)),
    ).toEqual([]);
  });
});
