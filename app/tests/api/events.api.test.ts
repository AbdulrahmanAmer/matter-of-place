// POST /events through `handlePublic` against mop-dev (CI's stack in the `db` job). Committed mode: every case
// writes its rows under a path of its own and removes them afterwards.
import "./env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dbCallCount } from "../../src/server/lib/db";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, dbNow, type Db as Pg } from "../fixtures/db";

const REQUEST_ID = "req-api-events-0001";
const DAY_MS = 86_400_000;

let ipCounter = 0;
const nextIp = () =>
  `198.30.${String(Math.floor(Math.random() * 200) + 20)}.${String((ipCounter += 1))}`;
const nextPath = () => `/__test/${randomUUID()}`;

function beacon(body: unknown, ip: string) {
  return new Request("http://localhost/api/public/events", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

const envelope = (path: string, over: Record<string, unknown> = {}) => ({
  event: "property_view",
  path,
  at: new Date().toISOString(),
  data: {},
  ...over,
});

/** Runs `fn` committed, then removes every row a test wrote under `/__test/`. */
function run<T>(fn: (pg: Pg) => Promise<T>): Promise<T> {
  return committed(fn, async (pg) => {
    await pg.query("begin");
    await pg.query("select set_config('mop.retention', 'on', true)");
    await pg.query("delete from public.analytics_events where path like '/__test/%'");
    await pg.query("commit");
  });
}

const rowSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
  occurred_at: z.date(),
});

async function rowsAt(pg: Pg, path: string) {
  const result = await pg.query(
    "select event, data, occurred_at from public.analytics_events where path = $1 order by id",
    [path],
  );
  return z.array(rowSchema).parse(result.rows);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/public/events", () => {
  it("stores a beacon of 20 envelopes with one record_analytics_events call and answers 204 with x-mop-cache: bypass", async () => {
    const path = nextPath();
    const { response, calls, rows } = await run(async (pg) => {
      const before = dbCallCount();
      const answer = await handlePublic(
        beacon(
          Array.from({ length: 20 }, (_, n) => envelope(path, { data: { n } })),
          nextIp(),
        ),
        REQUEST_ID,
      );
      return { response: answer, calls: dbCallCount() - before, rows: await rowsAt(pg, path) };
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(response.headers.get("x-catalog-version")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toBe(1);
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.data["n"])).toEqual(Array.from({ length: 20 }, (_, n) => n));
  });

  it("stores data.utm unchanged, so data->'utm'->>'utm_medium' reads social", async () => {
    const path = nextPath();
    const utm = { utm_source: "instagram", utm_medium: "social", utm_campaign: "s" };
    const { status, medium } = await run(async (pg) => {
      const answer = await handlePublic(
        beacon([envelope(path, { data: { utm } })], nextIp()),
        REQUEST_ID,
      );
      const read = await pg.query<{ medium: string }>(
        "select data->'utm'->>'utm_medium' as medium from public.analytics_events where path = $1",
        [path],
      );
      return { status: answer.status, medium: read.rows[0]?.medium };
    });
    expect(status).toBe(204);
    expect(medium).toBe("social");
  });

  it("answers 422 for a utm_source of 101 characters and stores nothing", async () => {
    const path = nextPath();
    const { response, rows } = await run(async (pg) => ({
      response: await handlePublic(
        beacon([envelope(path, { data: { utm: { utm_source: "x".repeat(101) } } })], nextIp()),
        REQUEST_ID,
      ),
      rows: await rowsAt(pg, path),
    }));
    expect(response.status).toBe(422);
    expect(rows).toEqual([]);
  });

  it("answers 422 for 21 envelopes, makes no database call and stores nothing", async () => {
    const path = nextPath();
    const { response, calls, rows } = await run(async (pg) => {
      const before = dbCallCount();
      const answer = await handlePublic(
        beacon(
          Array.from({ length: 21 }, () => envelope(path)),
          nextIp(),
        ),
        REQUEST_ID,
      );
      return { response: answer, calls: dbCallCount() - before, rows: await rowsAt(pg, path) };
    });
    expect(response.status).toBe(422);
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it("answers 422 for an empty batch", async () => {
    const response = await handlePublic(beacon([], nextIp()), REQUEST_ID);
    expect(response.status).toBe(422);
  });

  it("clamps occurred_at to within 24 hours of now", async () => {
    const path = nextPath();
    const { stamp, past, future } = await run(async (pg) => {
      const now = await dbNow(pg);
      await handlePublic(
        beacon(
          [
            envelope(path, { at: new Date(now.getTime() - 5 * DAY_MS).toISOString() }),
            envelope(path, { at: new Date(now.getTime() + 5 * DAY_MS).toISOString() }),
          ],
          nextIp(),
        ),
        REQUEST_ID,
      );
      const rows = await rowsAt(pg, path);
      return {
        stamp: now.getTime(),
        past: rows[0]?.occurred_at.getTime(),
        future: rows[1]?.occurred_at.getTime(),
      };
    });
    expect(Math.abs((past ?? 0) - (stamp - DAY_MS))).toBeLessThan(120_000);
    expect(Math.abs((future ?? 0) - (stamp + DAY_MS))).toBeLessThan(120_000);
  });

  it("drops an unknown event name with 204, and stores the known names of the same beacon", async () => {
    const path = nextPath();
    const { response, rows, calls } = await run(async (pg) => {
      const before = dbCallCount();
      const answer = await handlePublic(
        beacon(
          [envelope(path, { event: "not_an_event" }), envelope(path, { event: "share" })],
          nextIp(),
        ),
        REQUEST_ID,
      );
      return { response: answer, rows: await rowsAt(pg, path), calls: dbCallCount() - before };
    });
    expect(response.status).toBe(204);
    expect(rows.map((row) => row.event)).toEqual(["share"]);
    expect(calls).toBe(1);
  });

  it("answers 204 and makes no database call when every name is unknown", async () => {
    const path = nextPath();
    const { response, calls } = await run(async () => {
      const before = dbCallCount();
      const answer = await handlePublic(
        beacon([envelope(path, { event: "not_an_event" })], nextIp()),
        REQUEST_ID,
      );
      return { response: answer, calls: dbCallCount() - before };
    });
    expect(response.status).toBe(204);
    expect(calls).toBe(0);
  });

  it("rejects data over 1 KB with 422 and stores nothing", async () => {
    const path = nextPath();
    const { response, rows } = await run(async (pg) => ({
      response: await handlePublic(
        beacon([envelope(path, { data: { note: "y".repeat(1100) } })], nextIp()),
        REQUEST_ID,
      ),
      rows: await rowsAt(pg, path),
    }));
    expect(response.status).toBe(422);
    expect(rows).toEqual([]);
  });

  it("scrubs an email-shaped value from data and path before it is stored", async () => {
    const path = nextPath();
    const address = "someone@example.com";
    const rows = await run(async (pg) => {
      await handlePublic(
        beacon(
          [
            envelope(path, { data: { query: `find ${address} now`, nested: { list: [address] } } }),
            envelope(`${path}/${address}`),
          ],
          nextIp(),
        ),
        REQUEST_ID,
      );
      const read = await pg.query<{ text: string }>(
        "select (path || ' ' || data::text) as text from public.analytics_events where path like $1",
        [`${path}%`],
      );
      return read.rows;
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.text).not.toContain("example.com");
    expect(rows.map((row) => row.text).join(" ")).toContain("[email]");
  });

  it("counts a beacon, not an event: the 121st beacon in a minute from one address is 429 with Retry-After", async () => {
    const ip = nextIp();
    const path = nextPath();
    const unknown = [envelope(path, { event: "not_an_event" })];
    const statuses: number[] = [];
    for (let sent = 1; sent <= 120; sent += 1) {
      statuses.push((await handlePublic(beacon(unknown, ip), REQUEST_ID)).status);
    }
    const refused = await handlePublic(beacon(unknown, ip), REQUEST_ID);
    expect(statuses.every((status) => status === 204)).toBe(true);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
