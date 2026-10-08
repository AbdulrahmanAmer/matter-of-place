// B7 invariant 17 (the caching contract, admin side): every admin list filters and sorts on an index its own migration
// creates, a write bumps `catalog_version` through B2's triggers exactly when the public catalog changes (F25 a), and
// the dashboard is one call of indexed counts (17d).
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { getDashboard } from "../../src/server/dashboard/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import type { Db as AppDb } from "../../src/server/lib/db";
import { createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { countingDb } from "../fixtures/db-counter";
import { createSubmission, publishedProperty } from "../fixtures/factories";

async function indexDefinitions(db: Db, table: string, names: string[]): Promise<string[]> {
  return (
    await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = $1 and indexname = any ($2::text[]) order by indexname`,
      [table, names],
    )
  ).rows.map((row) => row.indexdef);
}

async function catalogVersion(db: Db): Promise<number> {
  const { rows } = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  return Number(rows[0]?.version);
}

/** The case runs only against a database that holds step 7's migration (P-328). */
async function assertStep7(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.publish_property') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

/** The case runs only against a database that holds step 8's migration (P-328). */
async function assertStep8(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.reorder_media') is not null and to_regproc('public.set_media_alt') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

/** The case runs only against a database that holds step 7a's migration (P-328). */
async function assertStep7a(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.unpublish_property') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

async function versionOf(db: Db, id: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    "select version from public.properties where id = $1",
    [id],
  );
  return rows[0]?.version ?? 0;
}

/** A property ready to publish: every field filled (the factory), in review, with six photographs with alt text. */
async function inReview(db: Db, n: number): Promise<string> {
  const { id } = await publishedProperty(db, { n, editorial_state: "review", published_at: null });
  for (let order = 1; order <= 6; order += 1) {
    await db.query(
      `insert into public.property_media (property_id, media_key, alt, orientation, sort_order)
       values ($1, 'o/fixture/' || $2::int || '-0a1b2c3d.webp', 'Room', 'landscape', $2::int)`,
      [id, order],
    );
  }
  return id;
}

describe("admin list indexes", () => {
  it("the submissions list index leads with the state and pages by received_at desc, id", async () => {
    const definitions = await withRollback((db) =>
      indexDefinitions(db, "submissions", ["submissions_list_idx"]),
    );
    expect(definitions).toEqual([
      "CREATE INDEX submissions_list_idx ON public.submissions USING btree (workflow_state, received_at DESC, id)",
    ]);
  });

  it("the properties list pages by state, updated_at desc, id and the representatives by name", async () => {
    const definitions = await withRollback(async (db) => [
      ...(await indexDefinitions(db, "properties", ["properties_list_idx"])),
      ...(await indexDefinitions(db, "representatives", ["representatives_name_idx"])),
    ]);
    expect(definitions).toEqual([
      "CREATE INDEX properties_list_idx ON public.properties USING btree (editorial_state, updated_at DESC, id)",
      "CREATE INDEX representatives_name_idx ON public.representatives USING btree (lower(name), id)",
    ]);
  });

  it("the inquiries list index leads with the state and pages by received_at desc, id", async () => {
    const definitions = await withRollback((db) =>
      indexDefinitions(db, "inquiries", ["inquiries_list_idx"]),
    );
    expect(definitions).toEqual([
      "CREATE INDEX inquiries_list_idx ON public.inquiries USING btree (state, received_at DESC, id)",
    ]);
  });

  it("the stories list index leads with the state and pages by updated_at desc, id", async () => {
    const definitions = await withRollback((db) =>
      indexDefinitions(db, "stories", ["stories_list_idx"]),
    );
    expect(definitions).toEqual([
      "CREATE INDEX stories_list_idx ON public.stories USING btree (editorial_state, updated_at DESC, id)",
    ]);
  });
});

describe("catalog_version and the property writes (F25 a)", () => {
  it("publish_property raises it by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const id = await inReview(db, 9950);
      const before = await catalogVersion(db);
      await db.query("select public.publish_property($1, $2, $3, 'human', 'req-cv')", [
        id,
        await versionOf(db, id),
        editor,
      ]);
      expect((await catalogVersion(db)) - before).toBe(1);
    });
  });

  it("an edit of a published row raises it by exactly one, and an edit of a draft leaves it", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const published = await publishedProperty(db, { n: 9951 });
      const { id: draft } = await publishedProperty(db, {
        n: 9952,
        editorial_state: "draft",
        published_at: null,
      });
      const edit = async (id: string) => {
        const before = await catalogVersion(db);
        await db.query(
          `select public.update_property($1, $2, '{"title": "Edited"}', $3, 'human', 'req-cv')`,
          [id, await versionOf(db, id), editor],
        );
        return (await catalogVersion(db)) - before;
      };
      expect({ published: await edit(published.id), draft: await edit(draft) }).toEqual({
        published: 1,
        draft: 0,
      });
    });
  });

  it("an unpublish raises it by exactly one, and a takedown unpublish by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const unpublish = async (n: number, takedown: boolean) => {
        const { id } = await publishedProperty(db, { n });
        const before = await catalogVersion(db);
        await db.query(
          "select public.unpublish_property($1, 'owner_request', $2, $3, 'human', 'req-cv')",
          [id, takedown, editor],
        );
        return (await catalogVersion(db)) - before;
      };
      expect({
        unpublish: await unpublish(9953, false),
        takedown: await unpublish(9954, true),
      }).toEqual({
        unpublish: 1,
        takedown: 1,
      });
    });
  });

  it("a media reorder raises it by exactly one, and an alt edit by exactly one (B2's property_media trigger)", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const id = await inReview(db, 9996);
      const { rows } = await db.query<{ id: string }>(
        "select id from public.property_media where property_id = $1 order by sort_order",
        [id],
      );
      const order = rows.map((row) => row.id);
      const bumpOf = async (sql: string, params: unknown[]) => {
        const before = await catalogVersion(db);
        await db.query(sql, params);
        return (await catalogVersion(db)) - before;
      };
      expect({
        reorder: await bumpOf(
          "select public.reorder_media($1, $2::uuid[], $3, 'human', 'req-cv')",
          [id, [...order.slice(0, 4), order[5], order[4]], editor],
        ),
        alt: await bumpOf("select public.set_media_alt($1, 'The terrace', $2, 'human', 'req-cv')", [
          order[0],
          editor,
        ]),
      }).toEqual({ reorder: 1, alt: 1 });
    });
  });
});

/** The case runs only against a database that holds step 9's migration (P-328). */
async function assertStep9(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regprocedure('public.admin_dashboard()') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

async function dashboardKey(db: Db, key: string): Promise<unknown> {
  const { rows } = await db.query<{ v: unknown }>("select public.admin_dashboard() -> $1 as v", [
    key,
  ]);
  return rows[0]?.v;
}

/** The client `getDashboard` takes, answering `rpc` inside the test's transaction; `storage` is there for the counter. */
function rpcClient(db: Db): AppDb {
  const rpc = async (name: string) => {
    const { rows } = await db.query<{ v: unknown }>(`select public.${name}() as v`);
    return { data: rows[0]?.v ?? null, error: null };
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the service reads only `rpc`, the counter `storage`
  return { rpc, storage: {} } as unknown as AppDb;
}

describe("admin_dashboard() (step 9, invariant 17d)", () => {
  it("the dashboard service issues exactly one database call", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      const client = countingDb(rpcClient(db));
      const actor: AdminActor = {
        userId: "00000000-0000-4000-8000-0000000000d9",
        kind: "human",
        roles: ["commercial"],
        scopes: [],
        requestId: "req-dashboard",
      };
      const answer = await getDashboard(actor, client);
      expect({
        total: client.counts.total,
        rpc: client.counts.rpc,
        today: Array.isArray(answer.today),
      }).toEqual({ total: 1, rpc: { admin_dashboard: 1 }, today: true });
    });
  });

  it("assets_pending is 0 while assets is absent, and withdraw is empty while social_posts is absent", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      // The stack before B9 and B10: neither table exists, nor B11's broadcast count, which reads assets. Renamed
      // inside the rolled-back transaction, so no other session sees it.
      await db.query("set local lock_timeout = '5s'");
      await db.query("alter table public.assets rename to assets_absent_probe");
      await db.query("alter table public.social_posts rename to social_posts_absent_probe");
      await db.query(
        `create or replace function public.broadcast_recipients_since(p_since timestamptz) returns int
         language sql stable security definer set search_path = '' as $fn$ select 0 $fn$`,
      );
      const { rows } = await db.query<{ assets: string | null; posts: string | null }>(
        "select to_regclass('public.assets')::text as assets, to_regclass('public.social_posts')::text as posts",
      );
      expect({
        absent: rows[0],
        assets_pending: await dashboardKey(db, "assets_pending"),
        withdraw: await dashboardKey(db, "withdraw"),
      }).toEqual({
        absent: { assets: null, posts: null },
        assets_pending: 0,
        withdraw: { open: 0, oldest_at: null },
      });
    });
  });

  it("assets_pending and withdraw count the rows once both tables exist", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      // One pending cover, one live post a takedown flagged and one already withdrawn, so no count matches by chance.
      const { id: propertyId } = await publishedProperty(db, { n: 9965 });
      await db.query(
        `with asset as (select (public.upsert_asset_stub($1, 'cover', 1, null)).id)
         insert into public.social_posts (asset_id, property_id, channel, status, scheduled_at, posted_at,
           withdraw_required_at, withdrawn_at)
         select asset.id, $1, channel, 'posted', now(), now(), now(), withdrawn
         from asset, (values ('x', null::timestamptz), ('linkedin', now())) posts (channel, withdrawn)`,
        [propertyId],
      );
      const { rows } = await db.query<{ pending: number; open: number }>(
        `select (select count(*)::int from public.assets where status = 'pending') as pending,
           (select count(*)::int from public.social_posts
            where withdraw_required_at is not null and withdrawn_at is null) as open`,
      );
      const { rows: read } = await db.query<{ pending: number; open: number }>(
        `select (d ->> 'assets_pending')::int as pending, (d -> 'withdraw' ->> 'open')::int as open
         from public.admin_dashboard() d`,
      );
      expect(read[0]).toEqual(rows[0]);
    });
  });

  it("every state count equals the group-by row of submissions in the same transaction", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      const base = await dbNow(db);
      const states = ["Submitted", "Under Review", "Declined"] as const;
      for (const [index, state] of states.entries()) {
        await createSubmission(db, { state, n: 9960 + index, base });
      }
      const { rows } = await db.query<{ workflow_state: string; count: number }>(
        "select workflow_state, count(*)::int as count from public.submissions group by 1",
      );
      expect(await dashboardKey(db, "counts")).toEqual(
        Object.fromEntries(rows.map((row) => [row.workflow_state, row.count])),
      );
    });
  });

  it("the mail counts equal email_sent_today(), this UTC month's rows and seven days of email_messages", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      const sentMonth = async () => {
        const { rows } = await db.query<{ v: string }>(
          "select public.admin_dashboard() -> 'email' ->> 'sent_month' as v",
        );
        return Number(rows[0]?.v);
      };
      const before = await sentMonth();
      // Three rows fall in this UTC month (two now, one at its first instant) and one in the month before. On the
      // first day of a month the month and the day coincide, so this case cannot tell them apart then.
      await db.query(
        `with bounds as (select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as month)
         insert into public.email_messages (template_key, kind, to_email, status, sent_at)
         select v.template_key, 'transactional', v.to_email, v.status, v.sent_at from bounds,
           lateral (values ('declined', 'dashboard+1@fixtures.invalid', 'bounced', now()),
             ('accepted', 'dashboard+2@fixtures.invalid', 'delivered', now()),
             ('accepted', 'dashboard+3@fixtures.invalid', 'delivered', bounds.month),
             ('accepted', 'dashboard+4@fixtures.invalid', 'delivered', bounds.month - interval '1 second'))
             as v (template_key, to_email, status, sent_at)`,
      );
      expect((await sentMonth()) - before).toBe(3);
      const { rows } = await db.query<Record<string, number>>(
        `select public.email_sent_today() as sent_today,
           (select count(*)::int from public.email_messages
            where sent_at >= now() - interval '7 days') as sent_7d,
           (select count(*)::int from public.email_messages
            where sent_at >= now() - interval '7 days' and status in ('bounced', 'complained')) as bounced_7d`,
      );
      expect(await dashboardKey(db, "email")).toEqual({ ...rows[0], sent_month: before + 3 });
    });
  });

  it("storage bytes equal the sum of object sizes over the three buckets", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      await db.query(
        `insert into storage.objects (bucket_id, name, metadata)
         values ('submissions', 'dashboard-probe/a', '{"size": 300}'),
           ('media', 'dashboard-probe/b', '{"size": 20}'),
           ('documents', 'dashboard-probe/c', '{"size": 1}')`,
      );
      const { rows } = await db.query<{ bytes: number }>(
        `select coalesce(sum((metadata ->> 'size')::bigint), 0)::int as bytes from storage.objects
         where bucket_id in ('submissions', 'media', 'documents')`,
      );
      expect(await dashboardKey(db, "storage")).toEqual({ bytes: rows[0]?.bytes });
    });
  });

  it("health is failed when the last finished health run has a failing check", async () => {
    await withRollback(async (db) => {
      await assertStep9(db);
      await db.query(
        `insert into public.jobs (type, idempotency_key, status, result, created_at, finished_at)
         values ('health', 'health:dashboard-probe', 'done',
           '{"checks": [{"name": "dead_jobs_24h", "status": "fail"}, {"name": "site", "status": "ok"}]}',
           now() + interval '1 minute', now() + interval '1 minute')`,
      );
      expect(await dashboardKey(db, "health")).toMatchObject({
        failed: true,
        failed_checks: ["dead_jobs_24h"],
      });
    });
  });
});

/** The case runs only against a database that holds step 12's migration (P-328). */
async function assertStep12(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.save_story') is not null and to_regproc('public.publish_story') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

/** A draft story (no image) or, with an image, one ready to publish; returns its id and `updated_at` as stored. */
async function storyRow(db: Db, slug: string, image: string | null) {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  const { rows } = await db.query<{ id: string; updated_at: string }>(
    `insert into public.stories (slug, title, deck, category, market_slug, image)
     values ($1, 'Fixture story', 'A deck.', 'Places', 'california', $2)
     returning id, updated_at::text as updated_at`,
    [slug, image],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("the story insert returned no row");
  return row;
}

describe("catalog_version and the story writes (F25 a)", () => {
  it("publish_story and unpublish_story each raise it by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const story = await storyRow(db, "cache-story", "s/cache-0a1b2c3d.webp");
      const beforePublish = await catalogVersion(db);
      await db.query("select public.publish_story($1, $2::timestamptz, $3, 'human', 'req-cv')", [
        story.id,
        story.updated_at,
        editor,
      ]);
      const published = (await catalogVersion(db)) - beforePublish;
      await db.query("select public.unpublish_story($1, $2, 'human', 'req-cv')", [
        story.id,
        editor,
      ]);
      expect({
        published,
        unpublished: (await catalogVersion(db)) - beforePublish - published,
      }).toEqual({
        published: 1,
        unpublished: 1,
      });
    });
  });

  it("save_story on a draft leaves it, and on a live story raises it by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const writer = await createStaffUser(db, ["visual_editor"]);
      const draft = await storyRow(db, "cache-draft", null);
      const beforeDraft = await catalogVersion(db);
      await db.query(
        `select public.save_story($1, $2::timestamptz, '{"title": "Edited"}', $3, 'human', 'req-cv')`,
        [draft.id, draft.updated_at, writer],
      );
      const draftBump = (await catalogVersion(db)) - beforeDraft;
      const live = await storyRow(db, "cache-live", "s/live-0a1b2c3d.webp");
      await db.query(
        "update public.stories set editorial_state = 'published', published_at = now() where id = $1",
        [live.id],
      );
      const current = await db.query<{ updated_at: string }>(
        "select updated_at::text as updated_at from public.stories where id = $1",
        [live.id],
      );
      const beforeLive = await catalogVersion(db);
      await db.query(
        `select public.save_story($1, $2::timestamptz, '{"title": "Edited"}', $3, 'human', 'req-cv')`,
        [live.id, current.rows[0]?.updated_at, writer],
      );
      expect({ draft: draftBump, live: (await catalogVersion(db)) - beforeLive }).toEqual({
        draft: 0,
        live: 1,
      });
    });
  });
});
