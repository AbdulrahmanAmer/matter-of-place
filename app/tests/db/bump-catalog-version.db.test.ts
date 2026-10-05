// B8b step 4 (Data changes, invariant 15 a): `open_market_on_publish` opens the market of a published property and, with
// `p_notify`, enqueues the one `market_open_notice` job in the same transaction (G15, G58); `bump_catalog_version()` and
// B2's trigger on `settings` are the only things that raise `catalog_version`. Every case runs in a rolled-back transaction.
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

const OPEN_NOTICE_KEY = "market_open:california";

async function scalar(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  const row = (await db.query<{ v: string }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

const catalogVersion = async (db: Db) =>
  Number(await scalar(db, "select (public.public_state() ->> 'catalog_version') as v"));

/** A published seeded property of California, and the market closed again behind it. */
async function closedCalifornia(db: Db): Promise<string> {
  const id = (
    await db.query<{ id: string }>(
      "select id from public.properties where market_slug = 'california' and editorial_state = 'published' limit 1",
    )
  ).rows[0]?.id;
  if (id === undefined) throw new Error("no published property in california: run the seed");
  await db.query("update public.markets set coming_soon = true where slug = 'california'");
  return id;
}

const isComingSoon = async (db: Db) =>
  (await scalar(
    db,
    "select coming_soon::text as v from public.markets where slug = 'california'",
  )) === "true";

const open = (db: Db, id: string, notify: boolean) =>
  scalar(db, "select public.open_market_on_publish($1, $2) as v", [id, notify]);

const noticeJobs = async (db: Db) =>
  Number(
    await scalar(db, "select count(*) as v from public.jobs where type = 'market_open_notice'"),
  );

describe("open_market_on_publish", () => {
  it("opens the market, audits it with no actor and enqueues one notice with one created event", async () => {
    const outcome = await withRollback(async (db) => {
      const id = await closedCalifornia(db);
      const versionBefore = await catalogVersion(db);
      const auditBefore = Number(
        await scalar(
          db,
          "select count(*) as v from public.audit_log where action = 'market.opened'",
        ),
      );
      const slug = await open(db, id, true);
      const audit = await db.query<{ actor_id: string | null; actor_kind: string | null }>(
        "select actor_id, actor_kind from public.audit_log where action = 'market.opened' order by at desc limit 1",
      );
      const jobs = await db.query<{ id: string; market: string }>(
        "select id, payload -> 'data' ->> 'market' as market from public.jobs where type = 'market_open_notice' and idempotency_key = $1",
        [OPEN_NOTICE_KEY],
      );
      const events = await db.query<{ kind: string }>(
        "select kind from public.job_events where job_id = $1",
        [jobs.rows[0]?.id],
      );
      return {
        slug,
        closed: await isComingSoon(db),
        audits:
          Number(
            await scalar(
              db,
              "select count(*) as v from public.audit_log where action = 'market.opened'",
            ),
          ) - auditBefore,
        actor: audit.rows[0],
        jobs: jobs.rows.map((row) => row.market),
        events: events.rows.map((row) => row.kind),
        raised: (await catalogVersion(db)) > versionBefore,
      };
    });
    expect(outcome).toEqual({
      slug: "california",
      closed: false,
      audits: 1,
      actor: { actor_id: null, actor_kind: null },
      jobs: ["california"],
      events: ["created"],
      raised: true,
    });
  });

  it("a second call returns null and adds no job", async () => {
    const outcome = await withRollback(async (db) => {
      const id = await closedCalifornia(db);
      await open(db, id, true);
      const second = await db.query<{ v: string | null }>(
        "select public.open_market_on_publish($1, true) as v",
        [id],
      );
      return { second: second.rows[0]?.v, jobs: await noticeJobs(db) };
    });
    expect(outcome).toEqual({ second: null, jobs: 1 });
  });

  it("with p_notify false the market opens and no job is created", async () => {
    const outcome = await withRollback(async (db) => {
      const id = await closedCalifornia(db);
      const slug = await open(db, id, false);
      return { slug, closed: await isComingSoon(db), jobs: await noticeJobs(db) };
    });
    expect(outcome).toEqual({ slug: "california", closed: false, jobs: 0 });
  });

  it("a draft property returns null and leaves the market closed", async () => {
    const outcome = await withRollback(async (db) => {
      await closedCalifornia(db);
      const inserted = await db.query<{ id: string }>(
        `insert into public.properties (slug, title, market_slug, city, state, address, type)
         values ('test-open-draft', 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence')
         returning id`,
      );
      const id = inserted.rows[0]?.id;
      const answer = await db.query<{ v: string | null }>(
        "select public.open_market_on_publish($1, true) as v",
        [id],
      );
      return { answer: answer.rows[0]?.v, closed: await isComingSoon(db) };
    });
    expect(outcome).toEqual({ answer: null, closed: true });
  });
});

describe("catalog_version", () => {
  it("bump_catalog_version() raises it by exactly one", async () => {
    const raised = await withRollback(async (db) => {
      const before = await catalogVersion(db);
      await db.query("select public.bump_catalog_version()");
      return (await catalogVersion(db)) - before;
    });
    expect(raised).toBe(1);
  });

  it("an update of the flags row raises it through B2's trigger, with no application code", async () => {
    const raised = await withRollback(async (db) => {
      const before = await catalogVersion(db);
      await db.query(
        `insert into public.settings (key, value) values ('flags', '{"new_channels": true}')
         on conflict (key) do update set value = excluded.value`,
      );
      return (await catalogVersion(db)) - before;
    });
    expect(raised).toBe(1);
  });
});
