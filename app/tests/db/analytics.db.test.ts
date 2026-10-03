// Ruling H16 (invariant 9): analytics_events is partitioned by month, raw rows are kept 90 days, and the two
// functions of migration 6 keep the partitions. Every case runs in UTC, the zone the functions work in.
import { describe, expect, it } from "vitest";
import { dbNow, withRollback, type Db } from "../fixtures/db";

async function inUtc<T>(run: (db: Db) => Promise<T>): Promise<T> {
  return withRollback(async (db) => {
    await db.query("set local time zone 'UTC'");
    return run(db);
  });
}

/** The name and bounds of the monthly partition `offset` months from the current month, in the function's naming. */
async function month(db: Db, offset: number) {
  const result = await db.query<{ name: string; from: string; to: string }>(
    `select 'analytics_events_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM') as name,
       (m at time zone 'UTC')::text as "from", ((m + interval '1 month') at time zone 'UTC')::text as "to"
     from (select date_trunc('month', now() at time zone 'UTC') + make_interval(months => $1::int) as m) as t`,
    [offset],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("the month query returned no row");
  return row;
}

async function partitions(db: Db): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `select c.relname as name
     from pg_inherits i join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.analytics_events'::regclass order by 1`,
  );
  return result.rows.map((row) => row.name);
}

const EVENT = `insert into public.analytics_events (event, path, occurred_at)
  values ('page_view', '/', $1) returning id, tableoid::regclass::text as partition`;

async function insertAt(db: Db, occurredAt: string | Date) {
  const result = await db.query<{ id: string; partition: string }>(EVENT, [occurredAt]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("the insert returned no row");
  return row;
}

describe("analytics partitions", () => {
  it("lists the current month, the next two and the default partition", async () => {
    const { listed, expected } = await inUtc(async (db) => {
      const names = ["analytics_events_default"];
      for (const offset of [0, 1, 2]) names.push((await month(db, offset)).name);
      return { listed: await partitions(db), expected: names.sort() };
    });
    expect(listed).toEqual(expected);
  });

  it("a row dated now lands in the current month's partition", async () => {
    const { landed, current } = await inUtc(async (db) => ({
      landed: (await insertAt(db, await dbNow(db))).partition,
      current: (await month(db, 0)).name,
    }));
    expect(landed).toBe(current);
  });

  it("a row after the last partition waits in the default one until ensure_analytics_partitions moves it", async () => {
    const seen = await inUtc(async (db) => {
      const later = await month(db, 3);
      const row = await insertAt(db, later.from);
      const waiting = row.partition;
      await db.query("select public.ensure_analytics_partitions(3)");
      const moved = await db.query<{ id: string; partition: string }>(
        "select id, tableoid::regclass::text as partition from public.analytics_events where id = $1",
        [row.id],
      );
      const left = await db.query<{ n: string }>(
        "select count(*) as n from public.analytics_events_default",
      );
      return { waiting, moved: moved.rows, left: left.rows[0]?.n, later: later.name, id: row.id };
    });
    expect(seen).toEqual({
      waiting: "analytics_events_default",
      moved: [{ id: seen.id, partition: seen.later }],
      left: "0",
      later: seen.later,
      id: seen.id,
    });
  });

  it("ensure_analytics_partitions twice changes nothing and each partition has row level security", async () => {
    const seen = await inUtc(async (db) => {
      await db.query("select public.ensure_analytics_partitions()");
      await db.query("select public.ensure_analytics_partitions(3)");
      const once = await partitions(db);
      await db.query("select public.ensure_analytics_partitions(3)");
      const twice = await partitions(db);
      const open = await db.query<{ name: string }>(
        `select c.relname as name
         from pg_inherits i join pg_class c on c.oid = i.inhrelid
         where i.inhparent = 'public.analytics_events'::regclass
           and (not c.relrowsecurity or has_table_privilege('anon', c.oid, 'select'))`,
      );
      return { same: once.join() === twice.join(), count: twice.length, open: open.rows };
    });
    expect(seen).toEqual({ same: true, count: 5, open: [] });
  });

  it("drop_old_analytics_partitions drops a partition past the months kept and keeps the rest", async () => {
    const seen = await inUtc(async (db) => {
      const old = await month(db, -2);
      const recent = await month(db, -1);
      for (const m of [old, recent]) {
        await db.query(
          `create table public.${m.name} partition of public.analytics_events
           for values from ('${m.from}') to ('${m.to}')`,
        );
      }
      const dropped = await db.query<{ n: number }>(
        "select public.drop_old_analytics_partitions(1) as n",
      );
      const left = await partitions(db);
      return {
        dropped: dropped.rows[0]?.n,
        oldGone: !left.includes(old.name),
        recentKept: left.includes(recent.name),
        currentKept: left.includes((await month(db, 0)).name),
        defaultKept: left.includes("analytics_events_default"),
      };
    });
    expect(seen).toEqual({
      dropped: 1,
      oldGone: true,
      recentKept: true,
      currentKept: true,
      defaultKept: true,
    });
  });

  it("keeps three months by default, the 90 days of ruling H16", async () => {
    const args = await inUtc(
      async (db) =>
        (
          await db.query<{ drop: string; ensure: string }>(
            `select pg_get_function_arguments('public.drop_old_analytics_partitions'::regproc) as drop,
              pg_get_function_arguments('public.ensure_analytics_partitions'::regproc) as ensure`,
          )
        ).rows[0],
    );
    expect(args).toEqual({
      drop: "keep_months integer DEFAULT 3",
      ensure: "months_ahead integer DEFAULT 2",
    });
  });

  it("an index on event and time serves the weekly counts", async () => {
    const indexes = await inUtc(
      async (db) =>
        (
          await db.query<{ indexname: string; indexdef: string }>(
            `select indexname, indexdef from pg_indexes
             where tablename = 'analytics_events' and indexname = 'analytics_events_event_occurred_idx'`,
          )
        ).rows,
    );
    expect(
      indexes.map((i) => [i.indexname, i.indexdef.endsWith("(event, occurred_at DESC)")]),
    ).toEqual([["analytics_events_event_occurred_idx", true]]);
  });
});
