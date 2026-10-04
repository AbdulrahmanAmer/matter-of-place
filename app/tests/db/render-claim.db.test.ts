// B9 step 7, PERF-01: claim_media_for_render gives each staged photograph to exactly one render_variants job. The
// cases run in rolled-back transactions through the harness (F22); the two-connection one commits its fixture rows and
// removes them in its cleanup.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { committed, withRollback, type Db } from "../fixtures/db";

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

async function property(db: Db, slug: string): Promise<string> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  return scalar<string>(
    db,
    `insert into public.properties (slug, title, market_slug, city, state, address, type)
     values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence') returning id as v`,
    [slug],
  );
}

/** `count` rows of `propertyId` with a staging path, sort_order 0 to count - 1. */
async function stage(db: Db, propertyId: string, count: number): Promise<void> {
  await db.query(
    `insert into public.property_media (property_id, staging_path, sort_order)
     select $1::uuid, 'staging/' || $1::text || '/' || n || '.jpg', n from generate_series(0, $2::int - 1) n`,
    [propertyId, count],
  );
}

/** A running render_variants job; no real runner holds it, the run_after is far away. */
async function job(db: Db): Promise<string> {
  const id = await scalar<string>(
    db,
    "select public.enqueue_job('render_variants', '{}', $1, p_run_after => now() + interval '1 day') as v",
    [`test:${randomUUID()}`],
  );
  await db.query("update public.jobs set status = 'running' where id = $1", [id]);
  return id;
}

const CLAIM = "select id, sort_order from public.claim_media_for_render($1, $2, $3::int)";

async function claim(
  db: Db,
  propertyId: string,
  jobId: string,
  limit = 40,
): Promise<{ id: string; sort_order: number }[]> {
  return (await db.query<{ id: string; sort_order: number }>(CLAIM, [propertyId, jobId, limit]))
    .rows;
}

describe("claim_media_for_render", () => {
  it("gives 40 staged rows to the first of 40 running jobs and nothing to the others", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-claim-forty");
      await stage(db, propertyId, 40);
      const sizes: number[] = [];
      const seen = new Set<string>();
      for (let n = 0; n < 40; n += 1) {
        const rows = await claim(db, propertyId, await job(db));
        sizes.push(rows.length);
        for (const { id } of rows) seen.add(id);
      }
      return { sizes, distinct: seen.size };
    });
    expect(result.sizes[0]).toBe(40);
    expect(result.sizes.reduce((sum, size) => sum + size, 0)).toBe(40);
    expect(result.distinct).toBe(40);
  });

  it("returns disjoint sets to two claims on two open transactions", async () => {
    const slug = `test-b9-claim-race-${randomUUID().slice(0, 8)}`;
    const sets = await committed(
      async (setup) => {
        const propertyId = await property(setup, slug);
        await stage(setup, propertyId, 40);
        const a = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
        const b = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
        await Promise.all([a.connect(), b.connect()]);
        try {
          await a.query("begin");
          await b.query("begin");
          // committed() never applies a registered mutation (it would commit it): the second claim applies it in its
          // own transaction, which rolls back, so a replay of the claim reaches the race (T-07).
          const mutation = process.env["MOP_MUTATION_SQL"];
          if (mutation !== undefined && mutation !== "") await b.query(mutation);
          const first = (await a.query<{ id: string }>(CLAIM, [propertyId, randomUUID(), 20])).rows;
          const pid = await scalar<number>(b, "select pg_backend_pid() as v");
          const second = b.query<{ id: string }>(CLAIM, [propertyId, randomUUID(), 20]);
          // B's statement has chosen its rows once it waits for A: B2's statement trigger on property_media bumps
          // catalog_version, whose one row A's open transaction holds. A commits only then.
          let waiting = false;
          for (let poll = 0; poll < 100 && !waiting; poll += 1) {
            await setup.query("select pg_stat_clear_snapshot()");
            const state = await setup.query<{ wait: string | null }>(
              "select wait_event_type as wait from pg_stat_activity where pid = $1",
              [pid],
            );
            waiting = state.rows[0]?.wait === "Lock";
            if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          await a.query("commit");
          const secondRows = (await second).rows;
          return {
            waiting,
            first: first.map(({ id }) => id),
            second: secondRows.map(({ id }) => id),
          };
        } finally {
          await b.query("rollback");
          await Promise.all([a.end(), b.end()]);
        }
      },
      async (setup) => {
        await setup.query("rollback");
        await setup.query("begin");
        try {
          await setup.query("select set_config('mop.retention', 'on', true)");
          await setup.query("delete from public.properties where slug = $1", [slug]);
          await setup.query("commit");
        } catch (error) {
          await setup.query("rollback");
          throw error;
        }
      },
    );
    expect(sets.waiting).toBe(true);
    expect(sets.first).toHaveLength(20);
    expect(sets.second).toHaveLength(20);
    expect(new Set([...sets.first, ...sets.second]).size).toBe(40);
  });

  it("claims a row again for a new job and for the failed job's own retry once its job is not running", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-claim-lapse");
      await stage(db, propertyId, 1);
      const first = await job(db);
      const second = await job(db);
      const held = await claim(db, propertyId, first);
      const blocked = await claim(db, propertyId, second);
      await db.query("update public.jobs set status = 'failed' where id = $1", [first]);
      const retry = await claim(db, propertyId, first);
      const taken = await claim(db, propertyId, second);
      return {
        held: held.length,
        blocked: blocked.length,
        retry: retry.length,
        taken: taken.length,
      };
    });
    expect(result).toEqual({ held: 1, blocked: 0, retry: 1, taken: 1 });
  });

  it("never claims a row with no staging path", async () => {
    const rows = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-claim-stored");
      await db.query(
        `insert into public.property_media (property_id, media_key, variants)
         values ($1, 'o/p/0-aaaaaaaa.webp', '{"hero": {"w": 1600, "h": 1067}}')`,
        [propertyId],
      );
      return claim(db, propertyId, await job(db));
    });
    expect(rows).toEqual([]);
  });

  it("returns p_limit rows in sort_order", async () => {
    const rows = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-claim-limit");
      await stage(db, propertyId, 10);
      return claim(db, propertyId, await job(db), 3);
    });
    expect(rows.map(({ sort_order }) => sort_order)).toEqual([0, 1, 2]);
  });
});
