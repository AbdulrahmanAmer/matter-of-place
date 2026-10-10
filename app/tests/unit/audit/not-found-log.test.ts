import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db";
import { handle, type PipelineDeps } from "../../../src/server/lib/pipeline";
import { countingDb } from "../../fixtures/db-counter";
import { fakeDb } from "../../fixtures/fake-db";

// B14 GG-02, invariant 8: the unknown-path log stores no personal data, skips assets and probe noise, is capped at
// 1,000 rows a day, and writes one multi-row insert per buffer through a `waitUntil` promise. A failed flush drops
// its rows, logs once and never changes the response.

const rowSchema = z.object({
  event: z.literal("not_found"),
  path: z.string(),
  data: z.object({ referrer_host: z.string().nullable() }),
  occurred_at: z.string(),
});

const BASE = "https://matterofplace.com";
const warnLines: string[] = [];

/** A fresh module, so the per-isolate buffer and the daily counter start empty in every case. */
async function fresh() {
  vi.resetModules();
  return import("../../../src/server/lib/not-found-log");
}

function world(insert: (rows: Json) => number | Promise<number> = () => 0) {
  const batches: z.infer<typeof rowSchema>[][] = [];
  const db = countingDb(
    fakeDb({
      rpc: {
        record_analytics_events: ({ p_rows }) => {
          batches.push(z.array(rowSchema).parse(p_rows));
          return insert(p_rows);
        },
      },
    }),
  );
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  return { db, batches, pending, ctx };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { headers });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  warnLines.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warnLines.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("logNotFound", () => {
  it("drops the query string and keeps only the referrer's host", async () => {
    const { logNotFound } = await fresh();
    const { db, batches, pending, ctx } = world();
    logNotFound(
      db,
      get("/old/page?email=a@b.example&token=x", { referer: "https://news.example.com/a?b=c" }),
      ctx,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(pending);
    expect(batches).toEqual([
      [
        {
          event: "not_found",
          path: "/old/page",
          data: { referrer_host: "news.example.com" },
          occurred_at: "2026-10-10T12:00:00.000Z",
        },
      ],
    ]);
  });

  it("skips probe noise and static assets: /wp-admin/x, /a.php and /assets/x.js", async () => {
    const { logNotFound } = await fresh();
    const { db, pending, ctx } = world();
    for (const path of [
      "/wp-admin/x",
      "/a.php",
      "/assets/x.js",
      "/.env",
      "/.git/config",
      "/logo.PNG",
    ]) {
      logNotFound(db, get(path), ctx);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toEqual([]);
    expect(db.counts.total).toBe(0);
  });

  it("stops at 1,000 rows a UTC day and starts again the next day", async () => {
    const { logNotFound } = await fresh();
    const { db, batches, pending, ctx } = world();
    for (let index = 0; index < 1005; index += 1)
      logNotFound(db, get(`/missing-${String(index)}`), ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(pending);
    expect(batches.flat()).toHaveLength(1000);
    vi.setSystemTime(new Date("2026-10-11T00:00:01Z"));
    logNotFound(db, get("/next-day"), ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(pending);
    expect(batches.flat()).toHaveLength(1001);
  });

  it("writes ten rows of one window as one record_analytics_events call, counted on the wrapped client", async () => {
    const { logNotFound } = await fresh();
    const { db, batches, pending, ctx } = world();
    for (let index = 0; index < 10; index += 1)
      logNotFound(db, get(`/missing-${String(index)}`), ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(pending);
    expect(db.counts.rpc).toEqual({ record_analytics_events: 1 });
    expect(db.counts.total).toBe(1);
    expect(batches.map((rows) => rows.length)).toEqual([10]);
  });

  it("flushes one row after 10 seconds through the waitUntil promise, and the 20th row at once", async () => {
    const { logNotFound } = await fresh();
    const { db, batches, pending, ctx } = world();
    logNotFound(db, get("/one"), ctx);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(batches).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await pending[0];
    expect(batches.map((rows) => rows.length)).toEqual([1]);

    for (let index = 0; index < 20; index += 1)
      logNotFound(db, get(`/burst-${String(index)}`), ctx);
    expect(pending).toHaveLength(3);
    await pending[2];
    expect(batches.map((rows) => rows.length)).toEqual([1, 20]);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(pending);
    expect(db.counts.total).toBe(2);
  });

  it("resolves a rejected insert, logs not_found_flush_failed once and still answers 404", async () => {
    const { logNotFound } = await fresh();
    const { db, pending, ctx } = world(() => Promise.reject(new Error("insert refused")));
    const deps: PipelineDeps = {
      render: () => Promise.resolve(new Response("<html>gone</html>", { status: 404 })),
      redirect: () => Promise.resolve(null),
      cache: (_request, render) => render(),
      getFlags: () => Promise.resolve({}),
      report: () => Promise.resolve(),
      isApiRoute: () => false,
      notFound: (request, pipelineCtx) => {
        logNotFound(db, request, pipelineCtx);
      },
    };
    const response = await handle(get("/no-such-page"), { env: {}, ...ctx }, deps);
    expect(response.status).toBe(404);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(warnLines.filter((line) => line.includes("not_found_flush_failed"))).toEqual([
      JSON.stringify({ level: "warn", event: "not_found_flush_failed", dropped: 1 }),
    ]);
  });
});
