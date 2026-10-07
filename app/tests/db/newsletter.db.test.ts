// B11 step 4: the Place Notes tables and functions. Every case runs in one rolled-back transaction (F22) and reads
// time from the database (R51); the comparisons of stored times stay in SQL (G-700).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { definitionRow, definitions } from "../../src/templates/email/index";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  return (await one<{ v: T }>(db, sql, params)).v;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

// B11's matrix rows (step 6 generates them into action_roles); kept as they are when that migration is already in.
async function newsletterActions(db: Db): Promise<void> {
  await db.query(`
    insert into public.action_roles (action, roles, human_only)
    select a, array['chief_editor', 'managing_editor', 'media_ops']::public.app_role[], a = 'newsletter.approve'
    from unnest(array['newsletter.build', 'newsletter.update', 'newsletter.approve', 'newsletter.unapprove',
      'newsletter.subscribers_export']) a
    on conflict (action) do nothing`);
}

async function editor(db: Db): Promise<string> {
  await newsletterActions(db);
  return createStaffUser(db, ["managing_editor"]);
}

const INTRO = JSON.stringify([{ id: "intro:1", type: "intro", text: "A note before the houses." }]);

/** The open draft with one intro block, made the way `queue_digest` makes it (no actor). */
async function draft(db: Db): Promise<string> {
  const saved = await scalar<{ id: string }>(
    db,
    "select public.newsletter_save_draft($1::jsonb, 'Place Notes No. 1', 'A note', null, null, 'req-build') as v",
    [INTRO],
  );
  return saved.id;
}

const approve = (db: Db, issue: string, actor: string, sendAt = "now() + interval '3 days'") =>
  attempt(db, `select public.newsletter_approve_issue($1, ${sendAt}, $2, 'human', 'req-approve')`, [
    issue,
    actor,
  ]);

interface JobRow {
  type: string;
  status: string;
  idempotency_key: string;
  issue_id: string;
  approval_count: string;
  on_time: boolean;
}

/** The newsletter jobs of `issue`; `on_time` compares run_after with the rule of invariants 6 and 11 in SQL. */
async function jobsOf(db: Db, issue: string): Promise<JobRow[]> {
  const { rows } = await db.query<JobRow>(
    `select j.type, j.status::text as status, j.idempotency_key,
       j.payload -> 'data' ->> 'issue_id' as issue_id,
       j.payload -> 'data' ->> 'approval_count' as approval_count,
       j.run_after = case j.type
         when 'newsletter_send' then i.scheduled_for
         else greatest(i.scheduled_for - interval '24 hours', j.created_at)
       end as on_time
     from public.jobs j join public.newsletter_issues i on i.id = $1
     where j.type in ('newsletter_send', 'newsletter_preview') and j.payload -> 'data' ->> 'issue_id' = $1::text
     order by j.idempotency_key`,
    [issue],
  );
  return rows;
}

async function market(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x') on conflict (slug) do nothing`,
  );
}

async function property(db: Db): Promise<string> {
  await market(db);
  return scalar<string>(
    db,
    `insert into public.properties (slug, title, market_slug, city, state, address, type, campaign_tier)
     values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence', 'Campaign')
     returning id as v`,
    [`test-${randomUUID()}`],
  );
}

/** An approved newsletter_block asset of `revision` whose block title names the revision. */
async function blockAsset(db: Db, propertyId: string, revision: number): Promise<string> {
  return scalar<string>(
    db,
    `insert into public.assets (property_id, kind, revision, status, meta)
     values ($1, 'newsletter_block', $2::int, 'approved',
       jsonb_build_object('block', jsonb_build_object('title', 'Revision ' || $2::int, 'deck', 'A deck.')))
     returning id as v`,
    [propertyId, revision],
  );
}

interface SubscriberInput {
  source?: string;
  markets?: string[];
  confirmed?: boolean;
  unsubscribed?: boolean;
  archived?: boolean;
  email?: string;
}

async function subscriber(db: Db, input: SubscriberInput): Promise<string> {
  return scalar<string>(
    db,
    `insert into public.subscribers (email, source, markets, confirmed_at, unsubscribed_at, archived_at)
     values ($1, $2, $3, case when $4 then now() end, case when $5 then now() end, case when $6 then now() end)
     returning id as v`,
    [
      input.email ?? `test-${randomUUID()}@example.test`,
      input.source ?? "footer",
      input.markets ?? [],
      input.confirmed ?? true,
      input.unsubscribed ?? false,
      input.archived ?? false,
    ],
  );
}

describe("newsletter_issues", () => {
  it("holds one draft: two adds share it, and a second draft row is refused", async () => {
    await withRollback(async (db) => {
      const first = await property(db);
      const second = await property(db);
      const [a, b] = await Promise.all([
        scalar<string>(db, "select public.queue_digest_add($1, $2) as v", [
          first,
          await blockAsset(db, first, 1),
        ]),
        scalar<string>(db, "select public.queue_digest_add($1, $2) as v", [
          second,
          await blockAsset(db, second, 1),
        ]),
      ]);
      const drafts = await scalar<number>(
        db,
        "select count(*)::int as v from public.newsletter_issues where status = 'draft'",
      );
      const blocks = await scalar<number>(
        db,
        "select jsonb_array_length(blocks) as v from public.newsletter_issues where id = $1",
        [a],
      );
      const extra = await attempt(
        db,
        "insert into public.newsletter_issues (number) select max(number) + 1 from public.newsletter_issues",
      );
      expect({ same: a === b, drafts, blocks, extra: extra.split(" ")[0] }).toEqual({
        same: true,
        drafts: 1,
        blocks: 2,
        extra: "23505",
      });
    });
  });

  it("queue_digest_add keeps one block per property: revision 2 replaces revision 1, and 1 again changes nothing", async () => {
    await withRollback(async (db) => {
      const id = await property(db);
      const first = await blockAsset(db, id, 1);
      const second = await blockAsset(db, id, 2);
      const issue = await scalar<string>(db, "select public.queue_digest_add($1, $2) as v", [
        id,
        first,
      ]);
      await db.query("select public.queue_digest_add($1, $2)", [id, second]);
      await db.query("select public.queue_digest_add($1, $2)", [id, first]);
      const blocks = await scalar<{ asset_id: string; title: string; id: string }[]>(
        db,
        "select blocks as v from public.newsletter_issues where id = $1",
        [issue],
      );
      expect(blocks).toEqual([
        {
          id: `property:${id}`,
          type: "property",
          property_id: id,
          asset_id: second,
          title: "Revision 2",
          deck: "A deck.",
        },
      ]);
    });
  });

  it("newsletter_save_draft with no actor writes one newsletter.build system row", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const rows = await db.query<{
        actor_id: string | null;
        actor_kind: string | null;
        note: string;
      }>(
        "select actor_id, actor_kind::text, note from public.audit_log where action = 'newsletter.build' and entity_id = $1",
        [issue],
      );
      expect(rows.rows).toEqual([{ actor_id: null, actor_kind: null, note: "system" }]);
    });
  });
});

describe("approval", () => {
  it("refuses an agent and a call with no actor with human_only, and the issue stays a draft", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const agent = await editor(db);
      await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [
        agent,
      ]);
      const asAgent = await attempt(
        db,
        "select public.newsletter_approve_issue($1, null, $2, 'agent', 'req')",
        [issue, agent],
      );
      const asSystem = await attempt(
        db,
        "select public.newsletter_approve_issue($1, null, null, null, 'req')",
        [issue],
      );
      const status = await scalar<string>(
        db,
        "select status as v from public.newsletter_issues where id = $1",
        [issue],
      );
      expect({ asAgent, asSystem, status }).toEqual({
        asAgent: "42501 human_only",
        asSystem: "42501 human_only",
        status: "draft",
      });
    });
  });

  it("refuses an agent's id passed as a human (write_audit, DB-04), and the issue stays a draft", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const agent = await editor(db);
      await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [
        agent,
      ]);
      const outcome = await approve(db, issue, agent);
      const { status, jobs } = await one<{ status: string; jobs: number }>(
        db,
        `select i.status, (select count(*)::int from public.jobs j
           where j.payload -> 'data' ->> 'issue_id' = i.id::text) as jobs
         from public.newsletter_issues i where i.id = $1`,
        [issue],
      );
      expect({ outcome, status, jobs }).toEqual({
        outcome: "42501 forbidden",
        status: "draft",
        jobs: 0,
      });
    });
  });

  it("a human approve three days out queues the send at send_at and the preview a day before, with one audit row", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const human = await editor(db);
      expect(await approve(db, issue, human)).toBe("ok");
      const audits = await scalar<number>(
        db,
        "select count(*)::int as v from public.audit_log where action = 'newsletter.approve' and entity_id = $1",
        [issue],
      );
      expect({ jobs: await jobsOf(db, issue), audits }).toEqual({
        jobs: [
          {
            type: "newsletter_preview",
            status: "queued",
            idempotency_key: `newsletter_preview:${issue}:1`,
            issue_id: issue,
            approval_count: "1",
            on_time: true,
          },
          {
            type: "newsletter_send",
            status: "queued",
            idempotency_key: `newsletter_send:${issue}:1`,
            issue_id: issue,
            approval_count: "1",
            on_time: true,
          },
        ],
        audits: 1,
      });
    });
  });

  it("approving again cancels the first pair and queues a pair for count 2", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const human = await editor(db);
      await approve(db, issue, human);
      expect(await approve(db, issue, human, "now() + interval '5 days'")).toBe("ok");
      const jobs = await jobsOf(db, issue);
      expect(jobs.map(({ idempotency_key, status }) => `${idempotency_key} ${status}`)).toEqual([
        `newsletter_preview:${issue}:1 cancelled`,
        `newsletter_preview:${issue}:2 queued`,
        `newsletter_send:${issue}:1 cancelled`,
        `newsletter_send:${issue}:2 queued`,
      ]);
    });
  });

  it("newsletter_unapprove_issue cancels the pair, and refuses with draft_open while another draft exists", async () => {
    await withRollback(async (db) => {
      const issue = await draft(db);
      const human = await editor(db);
      await approve(db, issue, human);
      await draft(db);
      const refused = await attempt(
        db,
        "select public.newsletter_unapprove_issue($1, $2, 'human', 'req')",
        [issue, human],
      );
      await db.query("update public.newsletter_issues set status = 'sent' where status = 'draft'");
      const done = await attempt(
        db,
        "select public.newsletter_unapprove_issue($1, $2, 'human', 'req')",
        [issue, human],
      );
      const { status, approval_count } = await one<{ status: string; approval_count: number }>(
        db,
        "select status, approval_count from public.newsletter_issues where id = $1",
        [issue],
      );
      const jobs = await jobsOf(db, issue);
      expect({
        refused,
        done,
        status,
        approval_count,
        jobs: jobs.map(({ status: jobStatus }) => jobStatus),
      }).toEqual({
        refused: "55000 draft_open",
        done: "ok",
        status: "draft",
        approval_count: 2,
        jobs: ["cancelled", "cancelled"],
      });
    });
  });
});

describe("the send job's functions", () => {
  async function approved(db: Db): Promise<string> {
    const issue = await draft(db);
    await approve(db, issue, await editor(db), "now()");
    return issue;
  }

  it("newsletter_mark_sending refuses a stale approval_count and moves the current one to sending", async () => {
    await withRollback(async (db) => {
      const issue = await approved(db);
      const stale = await scalar<boolean>(db, "select public.newsletter_mark_sending($1, 0) as v", [
        issue,
      ]);
      const before = await scalar<string>(
        db,
        "select status as v from public.newsletter_issues where id = $1",
        [issue],
      );
      const current = await scalar<boolean>(
        db,
        "select public.newsletter_mark_sending($1, 1) as v",
        [issue],
      );
      const after = await scalar<string>(
        db,
        "select status as v from public.newsletter_issues where id = $1",
        [issue],
      );
      expect({ stale, before, current, after }).toEqual({
        stale: false,
        before: "approved",
        current: true,
        after: "sending",
      });
    });
  });

  it("keeps the first broadcast id, marks the issue sent with its recipients, and a later metrics merge keeps them", async () => {
    await withRollback(async (db) => {
      const issue = await approved(db);
      await db.query("select public.newsletter_mark_sending($1, 1)", [issue]);
      await db.query("select public.newsletter_set_broadcast_id($1, 'bc_first')", [issue]);
      await db.query("select public.newsletter_set_broadcast_id($1, 'bc_second')", [issue]);
      await db.query("select public.newsletter_mark_sent($1, 80)", [issue]);
      await db.query(
        `select public.newsletter_set_metrics($1, '{"delivered": 78, "recipients": 0}')`,
        [issue],
      );
      const row = await one<object>(
        db,
        `select status, resend_broadcast_id, sent_at = now() as sent_now, metrics
         from public.newsletter_issues where id = $1`,
        [issue],
      );
      expect(row).toEqual({
        status: "sent",
        resend_broadcast_id: "bc_first",
        sent_now: true,
        metrics: { recipients: 80, delivered: 78 },
      });
    });
  });

  it("newsletter_set_contact then newsletter_clear_contact of the same id leaves resend_contact_id null", async () => {
    await withRollback(async (db) => {
      const id = await subscriber(db, {});
      await db.query("select public.newsletter_set_contact($1, 'ct_1')", [id]);
      const set = await scalar<string>(
        db,
        "select resend_contact_id as v from public.subscribers where id = $1",
        [id],
      );
      const cleared = await scalar<number>(
        db,
        "select public.newsletter_clear_contact('ct_1') as v",
      );
      const after = await scalar<string | null>(
        db,
        "select resend_contact_id as v from public.subscribers where id = $1",
        [id],
      );
      expect({ set, cleared, after }).toEqual({ set: "ct_1", cleared: 1, after: null });
    });
  });

  it("newsletter_set_audience writes the id under settings.resend.audiences", async () => {
    await withRollback(async (db) => {
      await db.query("select public.newsletter_set_audience('place-notes', 'aud_1')");
      const audiences = await scalar<Record<string, string>>(
        db,
        "select value -> 'audiences' as v from public.settings where key = 'resend'",
      );
      expect(audiences["place-notes"]).toBe("aud_1");
    });
  });
});

describe("audiences", () => {
  async function members(db: Db, audience: string, ids: string[]): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.newsletter_audience_members($1) where id = any ($2::uuid[])",
      [audience, ids],
    );
    return rows.map(({ id }) => id);
  }

  it("place-notes holds only confirmed, subscribed, kept, unsuppressed Place Notes subscribers", async () => {
    await withRollback(async (db) => {
      const count = () =>
        scalar<number>(db, "select public.newsletter_recipient_count('place-notes') as v");
      const before = await count();
      const member = await subscriber(db, {});
      const suppressed = `test-${randomUUID()}@example.test`;
      await db.query(
        "insert into public.email_suppressions (email, reason) values ($1, 'bounce')",
        [suppressed],
      );
      const others = {
        interest: await subscriber(db, { source: "interest:california", markets: ["california"] }),
        unconfirmed: await subscriber(db, { confirmed: false }),
        unsubscribed: await subscriber(db, { unsubscribed: true }),
        archived: await subscriber(db, { archived: true }),
        suppressed: await subscriber(db, { email: suppressed }),
        anonymised: await subscriber(db, { email: `deleted-${randomUUID()}@example.invalid` }),
      };
      expect({
        members: await members(db, "place-notes", [member, ...Object.values(others)]),
        added: (await count()) - before,
      }).toEqual({ members: [member], added: 1 });
    });
  });

  it("market-ca holds the Place Notes subscribers of California and no interest signup", async () => {
    await withRollback(async (db) => {
      const californian = await subscriber(db, { markets: ["california"] });
      const floridian = await subscriber(db, { markets: ["florida"] });
      const interest = await subscriber(db, {
        source: "interest:california",
        markets: ["california"],
      });
      expect(await members(db, "market-ca", [californian, floridian, interest])).toEqual([
        californian,
      ]);
    });
  });

  it("refuses an audience key outside the four with unknown_audience", async () => {
    await withRollback(async (db) => {
      expect(
        await attempt(db, "select * from public.newsletter_audience_members('market-xx')"),
      ).toBe("22023 unknown_audience");
    });
  });

  it("confirming a subscriber creates no job (contacts are reconciled, G14)", async () => {
    await withRollback(async (db) => {
      const id = await subscriber(db, { confirmed: false });
      const before = await scalar<number>(db, "select count(*)::int as v from public.jobs");
      await db.query("update public.subscribers set confirmed_at = now() where id = $1", [id]);
      expect(await scalar<number>(db, "select count(*)::int as v from public.jobs")).toBe(before);
    });
  });
});

describe("the daily and monthly counts", () => {
  it("count the recipients of a broadcast sent today and skip a dry run's", async () => {
    await withRollback(async (db) => {
      const counts = () =>
        one<{ today: number; month: number }>(
          db,
          "select public.email_sent_today() as today, public.email_sent_month() as month",
        );
      const before = await counts();
      await db.query(
        `insert into public.newsletter_issues (number, status, resend_broadcast_id, sent_at, metrics)
         select coalesce(max(number), 0) + 1, 'sent', 'bc_real', now(), '{"recipients": 80}' from public.newsletter_issues`,
      );
      const real = await counts();
      await db.query(
        `insert into public.newsletter_issues (number, status, resend_broadcast_id, sent_at, metrics)
         select max(number) + 1, 'sent', 'dry_x', now(), '{"recipients": 40}' from public.newsletter_issues`,
      );
      const dry = await counts();
      const id = await property(db);
      await db.query(
        `insert into public.assets (property_id, kind, status, meta)
         values ($1, 'standalone_email', 'approved', jsonb_build_object('broadcast',
           jsonb_build_object('id', 'bc_standalone', 'recipients', 5, 'sent_at', now())))`,
        [id],
      );
      const standalone = await counts();
      expect({
        real: [real.today - before.today, real.month - before.month],
        dry: [dry.today - real.today, dry.month - real.month],
        standalone: [standalone.today - dry.today, standalone.month - dry.month],
      }).toEqual({ real: [80, 80], dry: [0, 0], standalone: [5, 5] });
    });
  });
});

describe("standalone approval and the market-open key", () => {
  async function waitingStandalone(db: Db, propertyId: string): Promise<string> {
    return scalar<string>(
      db,
      `select public.enqueue_job('send_email', jsonb_build_object('params', jsonb_build_object('template', 'standalone'),
         'data', jsonb_build_object('property_id', $1::text)), $2, p_status => 'waiting_approval') as v`,
      [propertyId, `test:${randomUUID()}`],
    );
  }

  async function standaloneAsset(db: Db, propertyId: string): Promise<string> {
    return scalar<string>(
      db,
      `insert into public.assets (property_id, kind, meta)
       values ($1, 'standalone_email', '{"subject": "s", "preheader": "p", "block": {"title": "t"}}')
       returning id as v`,
      [propertyId],
    );
  }

  it("approving a standalone_email asset queues its property's waiting standalone send, and no other", async () => {
    await withRollback(async (db) => {
      const human = await createStaffUser(db, ["media_ops"]);
      const withJob = await property(db);
      const other = await property(db);
      const job = await waitingStandalone(db, withJob);
      const otherJob = await waitingStandalone(db, other);
      await db.query("select public.approve_asset($1, $2, 'human', 'req')", [
        await standaloneAsset(db, withJob),
        human,
      ]);
      const lone = await property(db);
      const loneOutcome = await attempt(db, "select public.approve_asset($1, $2, 'human', 'req')", [
        await standaloneAsset(db, lone),
        human,
      ]);
      const { rows } = await db.query<{ id: string; status: string }>(
        "select id, status::text from public.jobs where id = any ($1::uuid[]) order by status::text",
        [[job, otherJob]],
      );
      expect({ jobs: rows, loneOutcome }).toEqual({
        jobs: [
          { id: job, status: "queued" },
          { id: otherJob, status: "waiting_approval" },
        ],
        loneOutcome: "ok",
      });
    });
  });

  it("enqueue_job of market_open_notice twice returns an id then null, with one created event (G58)", async () => {
    await withRollback(async (db) => {
      // A market no seed opens, so the key is free whatever mop-dev already holds.
      const enqueue = () =>
        scalar<string | null>(
          db,
          `select public.enqueue_job('market_open_notice',
             '{"params":{},"data":{"market":"california"}}'::jsonb, 'market_open:test-market') as v`,
        );
      const first = await enqueue();
      const second = await enqueue();
      const created = await scalar<number>(
        db,
        "select count(*)::int as v from public.job_events where job_id = $1 and kind = 'created'",
        [first],
      );
      expect({ first: typeof first, second, created }).toEqual({
        first: "string",
        second: null,
        created: 1,
      });
    });
  });

  it("seeds the market_open row with its definition's class, copy and variables, enabled", async () => {
    const file = definitions.find((entry) => entry.definition.key === "market_open");
    if (file === undefined) throw new Error("no market-open.tsx definition");
    const row = await withRollback((db) =>
      one<object>(
        db,
        "select key, subject, preheader, body, class, variables, enabled from public.email_templates where key = 'market_open'",
      ),
    );
    const { key, subject, preheader, body } = definitionRow(file.definition);
    expect(row).toEqual({
      key,
      subject,
      preheader,
      body,
      class: file.definition.class,
      variables: [...file.definition.variables],
      enabled: true,
    });
  });
});

describe("grants", () => {
  it("authenticated can call none of the newsletter functions", async () => {
    const callable = await withRollback(async (db) => {
      const { rows } = await db.query<{ name: string }>(
        `select p.proname as name from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'newsletter\\_%' or p.proname in ('queue_digest_add', 'broadcast_recipients_since',
             'standalone_approve_job', 'email_sent_today', 'email_sent_month'))
           and has_function_privilege('authenticated', p.oid, 'execute')`,
      );
      return rows.map(({ name }) => name);
    });
    expect(callable).toEqual([]);
  });
});
