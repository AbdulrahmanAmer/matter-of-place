// checkDb against rate_limit_check on mop-dev (or CI's stack). Committed mode: supabase-js calls run on their own
// connection, so each case removes the hits of its own keys afterwards.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashKey } from "../../src/server/lib/ids";
import { checkDb, type DbCheck } from "../../src/server/lib/ratelimit";
import { committed, type Db as Pg } from "../fixtures/db";
import { serviceClient } from "../fixtures/service";

const db = serviceClient();
const HOUR = 3600;
const DAY = 86_400;

async function withKeys<T>(count: number, fn: (pg: Pg, keys: string[]) => Promise<T>): Promise<T> {
  const keys = await Promise.all(
    Array.from({ length: count }, () => hashKey("test-ratelimit", randomUUID())),
  );
  return committed(
    (pg) => fn(pg, keys),
    async (pg) => {
      await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
    },
  );
}

async function addHits(pg: Pg, check: DbCheck, count: number, age: string): Promise<void> {
  await pg.query(
    "insert into public.rate_limits (bucket, key_hash, at) select $1, $2, now() - $3::interval from generate_series(1, $4)",
    [check.bucket, check.keyHash, age, count],
  );
}

async function hitCount(pg: Pg, keyHash: string): Promise<number> {
  const result = await pg.query<{ count: number }>(
    "select count(*)::int as count from public.rate_limits where key_hash = $1",
    [keyHash],
  );
  return result.rows[0]?.count ?? -1;
}

const key = (keys: string[], index: number): string => {
  const value = keys[index];
  if (value === undefined) throw new Error(`no key ${String(index)}`);
  return value;
};

describe("rate_limit_check through checkDb", () => {
  it("refuses the 11th inquiry hit from one IP and lets a different IP pass", async () => {
    const outcome = await withKeys(2, async (_pg, keys) => {
      const inquiry = (keyHash: string): DbCheck[] => [
        { bucket: "inquiries:ip", keyHash, limit: 10, windowSeconds: HOUR },
      ];
      const results = [];
      for (let hit = 0; hit < 11; hit += 1) results.push(await checkDb(db, inquiry(key(keys, 0))));
      return { results, other: await checkDb(db, inquiry(key(keys, 1))) };
    });
    expect(outcome.results.slice(0, 10).every((result) => result.ok)).toBe(true);
    const refused = outcome.results[10];
    expect(refused?.ok).toBe(false);
    const retryAfter = refused !== undefined && !refused.ok ? refused.retryAfter : 0;
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(HOUR);
    expect(outcome.other).toEqual({ ok: true });
  });

  it("lets a call pass once the window of the earlier hits has elapsed", async () => {
    const result = await withKeys(1, async (pg, keys) => {
      const check = {
        bucket: "inquiries:ip",
        keyHash: key(keys, 0),
        limit: 10,
        windowSeconds: HOUR,
      };
      await addHits(pg, check, 10, "2 hours");
      return checkDb(db, [check]);
    });
    expect(result).toEqual({ ok: true });
  });

  it("writes no hit for any check when one check of the call fails", async () => {
    const outcome = await withKeys(2, async (pg, keys) => {
      const full = {
        bucket: "subscribers:ip",
        keyHash: key(keys, 0),
        limit: 1,
        windowSeconds: HOUR,
      };
      const fresh = {
        bucket: "subscribers:email",
        keyHash: key(keys, 1),
        limit: 5,
        windowSeconds: HOUR,
      };
      await addHits(pg, full, 1, "1 minute");
      const result = await checkDb(db, [full, fresh]);
      return {
        result,
        full: await hitCount(pg, full.keyHash),
        fresh: await hitCount(pg, fresh.keyHash),
      };
    });
    expect(outcome).toMatchObject({ result: { ok: false }, full: 1, fresh: 0 });
  });

  it("counts a hit dated 3 hours ago in a daily bucket, with retry_after inside the day", async () => {
    const result = await withKeys(1, async (pg, keys) => {
      const check = {
        bucket: "subjects-request:email",
        keyHash: key(keys, 0),
        limit: 1,
        windowSeconds: DAY,
      };
      await addHits(pg, check, 1, "3 hours");
      return checkDb(db, [check]);
    });
    expect(result.ok).toBe(false);
    const retryAfter = result.ok ? 0 : result.retryAfter;
    expect(retryAfter).toBeGreaterThan(DAY - 3 * HOUR - 60);
    expect(retryAfter).toBeLessThanOrEqual(DAY - 3 * HOUR);
  });

  it("counts two checks on one bucket against their own windows and records one hit per call", async () => {
    const outcome = await withKeys(1, async (pg, keys) => {
      const keyHash = key(keys, 0);
      const minute = { bucket: "agent:test", keyHash, limit: 2, windowSeconds: 60 };
      const day = { bucket: "agent:test", keyHash, limit: 3, windowSeconds: DAY };
      await addHits(pg, minute, 2, "2 minutes");
      const first = await checkDb(db, [minute, day]);
      const second = await checkDb(db, [minute, day]);
      return { first, second, hits: await hitCount(pg, keyHash) };
    });
    expect(outcome.first).toEqual({ ok: true });
    expect(outcome.second.ok).toBe(false);
    expect(outcome.second.ok ? 0 : outcome.second.retryAfter).toBeGreaterThan(60);
    expect(outcome.hits).toBe(3);
  });
});
