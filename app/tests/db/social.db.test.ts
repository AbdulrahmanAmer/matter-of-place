// B10 step 6: social.sql and its functions (invariants 2 to 4, 10 and 11, INT-01, INT-08, DB-04, DB-09, E2E-01, G21,
// G22, G60). Every case runs in a rolled-back transaction through the harness (F22); the two-connection case of
// store_channel_token holds two open transactions at once.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { definition } from "../../src/templates/email/campaign-report";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { createInvoice, createSubmission, publishedProperty } from "../fixtures/factories";

/**
 * Runs `sql` under a savepoint; the refusal as `<SQLSTATE>: <message>`, or null when it went through. The transaction
 * stays usable.
 */
async function refusal(db: Db, sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""}: ${error.message}`;
    throw error;
  }
}

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

const count = (db: Db, sql: string, params: unknown[] = []) =>
  scalar<number>(db, `select count(*)::int as v from (${sql}) q`, params);

const FILES = `[{"media_key":"assets/p/carousel/r1/slide-1.aaaaaaaa.jpg","w":1080,"h":1350,"bytes":1,"role":"slide","index":1}]`;

/** A published property of fixture number `n`, with a Published submission unless `submission` is false. */
async function property(
  db: Db,
  n: number,
  submission = true,
): Promise<{ id: string; submission: string | null }> {
  const submissionId = submission
    ? await createSubmission(db, { state: "Published", n, base: await dbNow(db) })
    : null;
  const row = await publishedProperty(db, { n, submission_id: submissionId });
  return { id: row.id, submission: submissionId };
}

/** A complete asset of `kind` at `status`; `approve` makes it approved through the table, as a person's approval did. */
async function asset(
  db: Db,
  propertyId: string,
  kind = "carousel",
  status = "approved",
): Promise<string> {
  const id = await scalar<string>(
    db,
    "select (public.upsert_asset_stub($1, $2::public.asset_kind, 1, null)).id as v",
    [propertyId, kind],
  );
  await db.query(
    `update public.assets set files = '${FILES}', caption = 'A caption.', alt_text = 'A house.' where id = $1`,
    [id],
  );
  if (status !== "pending") {
    await db.query("update public.assets set status = $2::public.asset_status where id = $1", [
      id,
      status,
    ]);
  }
  return id;
}

async function post(
  db: Db,
  assetId: string,
  channel: string,
  status = "scheduled",
  extra: { error?: string; withdraw?: boolean } = {},
): Promise<string> {
  return scalar<string>(
    db,
    `insert into public.social_posts (asset_id, property_id, channel, status, scheduled_at, posted_at, error,
       withdraw_required_at)
     select a.id, a.property_id, $2, $3::public.social_post_status, now(),
       case when $3 = 'posted' then now() end, $4, case when $5 then now() end
     from public.assets a where a.id = $1
     returning id as v`,
    [assetId, channel, status, extra.error ?? null, extra.withdraw === true],
  );
}

const auditRows = (db: Db, action: string, entityId?: string) =>
  db
    .query<{
      actor_id: string | null;
      actor_kind: string | null;
      note: string | null;
      entity: string;
    }>(
      `select actor_id, actor_kind::text, note, entity from public.audit_log
       where action = $1 and ($2::uuid is null or entity_id = $2) order by id`,
      [action, entityId ?? null],
    )
    .then((result) => result.rows);

const statusOf = (db: Db, table: string, id: string) =>
  scalar<string>(db, `select status::text as v from public.${table} where id = $1`, [id]);

describe("the seed", () => {
  it("sets the three live channels off with a Tuesday to Thursday morning window and a cap of 2", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ channel: string; enabled: boolean; posting_window: unknown }>(
            `select channel, enabled, posting_window from public.channel_settings
             where channel in ('instagram', 'x', 'linkedin') order by channel`,
          )
        ).rows,
    );
    const window = {
      days: [2, 3, 4],
      from: "09:00",
      to: "12:00",
      tz: "America/New_York",
      daily_cap: 2,
    };
    expect(rows).toEqual(
      ["instagram", "linkedin", "x"].map((channel) => ({
        channel,
        enabled: false,
        posting_window: window,
      })),
    );
  });
});

describe("posting", () => {
  it("keeps the asset approved with two of three targets posted and publishes it with the third", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9601);
      const assetId = await asset(db, id, "cover");
      const posts = [
        await post(db, assetId, "x"),
        await post(db, assetId, "linkedin"),
        await post(db, assetId, "facebook"),
      ];
      const targets = ["x", "linkedin", "facebook"];
      const states: string[] = [];
      for (const postId of posts) {
        await db.query("select public.mark_social_post_posted($1, 'r', 'https://p.test/r', $2)", [
          postId,
          targets,
        ]);
        states.push(await statusOf(db, "assets", assetId));
      }
      return states;
    });
    expect(result).toEqual(["approved", "approved", "published"]);
  });

  it("moves a Published submission to Distribution Active with the first post, once, and leaves a property without one", async () => {
    const result = await withRollback(async (db) => {
      const withSubmission = await property(db, 9602);
      const first = await asset(db, withSubmission.id, "cover");
      const a = await post(db, first, "x");
      const b = await post(db, first, "linkedin");
      const state = () =>
        scalar<string>(
          db,
          "select workflow_state::text as v from public.submissions where id = $1",
          [withSubmission.submission],
        );
      await db.query("select public.mark_social_post_posted($1, 'r', 'https://p.test/r', '{x}')", [
        a,
      ]);
      const afterFirst = await state();
      await db.query("select public.mark_social_post_posted($1, 'r', 'https://p.test/r', '{x}')", [
        b,
      ]);
      const afterSecond = await state();
      const alone = await property(db, 9603, false);
      const lone = await post(db, await asset(db, alone.id, "cover"), "x");
      const refused = await refusal(
        db,
        "select public.mark_social_post_posted($1, 'r', 'https://p.test/r', '{x}')",
        [lone],
      );
      return {
        afterFirst,
        afterSecond,
        refused,
        lonePosted: await statusOf(db, "social_posts", lone),
      };
    });
    expect(result).toEqual({
      afterFirst: "Distribution Active",
      afterSecond: "Distribution Active",
      refused: null,
      lonePosted: "posted",
    });
  });

  it("set_social_post_inflight keeps the first marker, takes a clean row and clears with no marker (INT-01)", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9604);
      const held = await post(db, await asset(db, id, "cover"), "x", "scheduled", {
        error: "inflight:2026-10-06T14:00:00Z:media:1",
      });
      const clean = await post(db, await asset(db, id, "carousel"), "instagram");
      const set = (postId: string, marker: string | null) =>
        scalar<boolean>(db, "select public.set_social_post_inflight($1, $2) as v", [
          postId,
          marker,
        ]);
      const second = await set(held, "inflight:2026-10-06T14:01:00Z:media:2");
      const kept = await scalar<string>(
        db,
        "select error as v from public.social_posts where id = $1",
        [held],
      );
      const taken = await set(clean, "container:9");
      const cleared = await set(held, null);
      const after = await scalar<string | null>(
        db,
        "select error as v from public.social_posts where id = $1",
        [held],
      );
      return { second, kept, taken, cleared, after };
    });
    expect(result).toEqual({
      second: false,
      kept: "inflight:2026-10-06T14:00:00Z:media:1",
      taken: true,
      cleared: true,
      after: null,
    });
  });

  it("fail_social_post changes nothing on a posted row, and cancel_social_post refuses one", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9605);
      const actor = await createStaffUser(db, ["media_ops"]);
      const posted = await post(db, await asset(db, id, "cover"), "x", "posted");
      const failed = await scalar<boolean>(
        db,
        "select public.fail_social_post($1, 'outcome_unknown') as v",
        [posted],
      );
      const cancel = await refusal(db, "select public.cancel_social_post($1, $2, 'human', 'req')", [
        posted,
        actor,
      ]);
      return { failed, status: await statusOf(db, "social_posts", posted), cancel };
    });
    expect(result).toEqual({
      failed: false,
      status: "posted",
      cancel: "55000: wrong_state",
    });
  });

  it("reschedule_social_post writes one channels.reschedule row with no actor", async () => {
    const rows = await withRollback(async (db) => {
      const { id } = await property(db, 9606);
      const postId = await post(db, await asset(db, id, "cover"), "x");
      await db.query(
        "select public.reschedule_social_post($1, now() + interval '1 day', 'moved')",
        [postId],
      );
      return auditRows(db, "channels.reschedule", postId);
    });
    expect(rows).toEqual([
      { actor_id: null, actor_kind: null, note: "moved", entity: "social_posts" },
    ]);
  });

  it("a commercial session cannot write social_posts", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9607);
      const postId = await post(db, await asset(db, id, "cover"), "x");
      const user = await createStaffUser(db, ["commercial"]);
      await asRole(db, "authenticated", user);
      return {
        update: await refusal(db, "update public.social_posts set error = 'x' where id = $1", [
          postId,
        ]),
        reads: await count(db, "select 1 from public.social_posts where id = $1", [postId]),
      };
    });
    expect(result).toEqual({
      update: "42501: permission denied for table social_posts",
      reads: 1,
    });
  });
});

describe("retry and metrics refresh", () => {
  it("retry_social_post schedules an x row again with one post_x job and one channels.retry row", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9608);
      const assetId = await asset(db, id, "cover");
      const actor = await createStaffUser(db, ["media_ops"]);
      const x = await post(db, assetId, "x", "failed", { error: "outcome_unknown" });
      const instagram = await post(db, await asset(db, id, "carousel"), "instagram", "failed", {
        error: "x",
      });
      const xJob = await scalar<string>(
        db,
        "select public.retry_social_post($1, false, $2, 'human', 'req') as v",
        [x, actor],
      );
      const igJob = await scalar<string>(
        db,
        "select public.retry_social_post($1, true, $2, 'human', 'req') as v",
        [instagram, actor],
      );
      const jobs = await db.query<{
        id: string;
        type: string;
        key: string;
        params: unknown;
        asset: string;
      }>(
        `select id, type, idempotency_key as key, payload -> 'params' as params, payload -> 'data' ->> 'asset_id' as asset
         from public.jobs where id in ($1, $2) order by type`,
        [xJob, igJob],
      );
      return {
        status: await statusOf(db, "social_posts", x),
        jobs: jobs.rows,
        audit: (await auditRows(db, "channels.retry", x)).length,
        x,
        assetId,
      };
    });
    expect(result.status).toBe("scheduled");
    expect(result.audit).toBe(1);
    expect(result.jobs).toEqual([
      expect.objectContaining({ type: "post_meta", params: { channels: ["instagram"] } }),
      expect.objectContaining({
        type: "post_x",
        key: `post_x:${result.x}:1`,
        params: {},
        asset: result.assetId,
      }),
    ]);
  });

  it("refresh_social_post_metrics numbers its jobs :1 and :2, and :3 beside the story job", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9609);
      const actor = await createStaffUser(db, ["media_ops"]);
      const postId = await post(db, await asset(db, id, "story"), "instagram", "posted");
      const refresh = () =>
        scalar<string>(
          db,
          "select public.refresh_social_post_metrics($1, $2, 'human', 'req') as v",
          [postId, actor],
        );
      const keyOf = async (job: string) =>
        scalar<string>(db, "select idempotency_key as v from public.jobs where id = $1", [job]);
      const keys = [await keyOf(await refresh()), await keyOf(await refresh())];
      await db.query("select public.enqueue_job('reconcile', '{}', $1)", [
        `reconcile_story:${postId}`,
      ]);
      keys.push(await keyOf(await refresh()));
      return {
        keys,
        postId,
        audit: (await auditRows(db, "channels.metrics_refresh", postId)).length,
      };
    });
    expect(result.keys).toEqual([1, 2, 3].map((n) => `reconcile:${result.postId}:${String(n)}`));
    expect(result.audit).toBe(3);
  });

  it("raises enqueue_failed and changes nothing when no job is made (DB-09)", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9610);
      const actor = await createStaffUser(db, ["media_ops"]);
      const failed = await post(db, await asset(db, id, "cover"), "x", "failed", {
        error: "outcome_unknown",
      });
      const posted = await post(db, await asset(db, id, "story"), "instagram", "posted");
      await db.query(
        `create or replace function public.enqueue_job_manual(p_type text, p_entity_id uuid, p_payload jsonb,
           p_max_attempts int default 5) returns uuid language sql as $$ select null::uuid $$`,
      );
      return {
        retry: await refusal(db, "select public.retry_social_post($1, false, $2, 'human', 'req')", [
          failed,
          actor,
        ]),
        refresh: await refusal(
          db,
          "select public.refresh_social_post_metrics($1, $2, 'human', 'req')",
          [posted, actor],
        ),
        status: await statusOf(db, "social_posts", failed),
        audit:
          (await auditRows(db, "channels.retry")).length +
          (await auditRows(db, "channels.metrics_refresh")).length,
      };
    });
    expect(result).toEqual({
      retry: "55000: enqueue_failed",
      refresh: "55000: enqueue_failed",
      status: "failed",
      audit: 0,
    });
  });
});

describe("withdraw by hand (E2E-01)", () => {
  it("mark_social_post_withdrawn sets withdrawn_at with one audit row, and refuses a row with nothing to withdraw", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9611);
      const actor = await createStaffUser(db, ["media_ops"]);
      const taken = await post(db, await asset(db, id, "cover"), "x", "posted", { withdraw: true });
      const plain = await post(db, await asset(db, id, "story"), "instagram", "posted");
      await db.query("select public.mark_social_post_withdrawn($1, $2, 'human', 'req')", [
        taken,
        actor,
      ]);
      return {
        done: await count(
          db,
          "select 1 from public.social_posts where id = $1 and withdrawn_at is not null",
          [taken],
        ),
        audit: (await auditRows(db, "channels.mark_withdrawn", taken)).length,
        plain: await refusal(
          db,
          "select public.mark_social_post_withdrawn($1, $2, 'human', 'req')",
          [plain, actor],
        ),
      };
    });
    expect(result).toEqual({
      done: 1,
      audit: 1,
      plain: "55000: invalid_state",
    });
  });
});

describe("approvals", () => {
  it("auto_approve_asset writes one system assets.auto_approve row and exactly one asset.approved event", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9612);
      const assetId = await asset(db, id, "carousel", "pending");
      const eventId = await scalar<string>(
        db,
        `select public.auto_approve_asset($1, '{"tier":"Feature","channels":["instagram"],"auto_after":"2026-10-05"}') as v`,
        [assetId],
      );
      const events = await db.query<{ id: string }>(
        "select id from public.events where type = 'asset.approved' and entity_id = $1",
        [assetId],
      );
      return {
        eventId,
        events: events.rows.map((row) => row.id),
        audit: await auditRows(db, "assets.auto_approve", assetId),
      };
    });
    expect(result.events).toEqual([result.eventId]);
    expect(result.audit).toEqual([
      { actor_id: null, actor_kind: null, note: "system", entity: "assets" },
    ]);
  });

  it("approve_asset refuses an agent or the system without evidence and approves with it, keeping the evidence", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await property(db, 9613);
      const assetId = await asset(db, id, "carousel", "pending");
      const human = await createStaffUser(db, ["media_ops"]);
      const agentRefused = await refusal(
        db,
        "select public.approve_asset($1, $2, 'agent', 'req')",
        [assetId, human],
      );
      const systemRefused = await refusal(
        db,
        "select public.approve_asset($1, null, null, 'req')",
        [assetId],
      );
      await db.query(
        `select public.approve_asset(p_asset => $1, p_actor => null, p_actor_kind => null, p_request_id => 'req',
           p_evidence => '{"tier":"Feature"}')`,
        [assetId],
      );
      const notes = await auditRows(db, "assets.approve", assetId);
      const other = await asset(db, id, "story", "pending");
      await db.query(
        "select public.approve_asset(p_asset => $1, p_actor => $2, p_actor_kind => 'human', p_request_id => 'req')",
        [other, human],
      );
      return {
        agentRefused,
        systemRefused,
        notes: notes.map((row) => row.note),
        status: await statusOf(db, "assets", assetId),
        other: await statusOf(db, "assets", other),
        overloads: await count(
          db,
          "select 1 from pg_proc where proname = 'approve_asset' and pronamespace = 'public'::regnamespace",
        ),
      };
    });
    expect(result).toEqual({
      agentRefused: "42501: manual_approval",
      systemRefused: "42501: manual_approval",
      notes: ['{"tier": "Feature"}'],
      status: "approved",
      other: "approved",
      overloads: 1,
    });
  });
});

describe("channel settings (G21, INT-08)", () => {
  const version = (db: Db) =>
    scalar<string>(
      db,
      "select value #>> '{}' as v from public.settings where key = 'catalog_version'",
    );

  it("record_channel_check keeps the ids, put_channel_ids refuses a token and audits the ids, and neither bumps the catalog", async () => {
    const result = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["media_ops"]);
      const before = await version(db);
      await db.query(
        `select public.put_channel_ids('x', '{"user_id":"1","handle":"mop"}', $1, 'human', 'req')`,
        [actor],
      );
      await db.query(
        "select public.record_channel_check('x', now() + interval '2 hours', now(), 'ok')",
      );
      const token = await refusal(
        db,
        `select public.put_channel_ids('meta', '{"page_id":"1","access_token":"t"}', $1, 'human', 'req')`,
        [actor],
      );
      const x = await scalar<Record<string, unknown>>(
        db,
        "select value as v from public.settings where key = 'x'",
      );
      return {
        ids: { user_id: x["user_id"], handle: x["handle"], token_state: x["token_state"] },
        token,
        meta: await scalar<unknown>(
          db,
          "select value as v from public.settings where key = 'meta'",
        ),
        audit: (await auditRows(db, "channels.ids_put")).length,
        moved: (await version(db)) !== before,
      };
    });
    expect(result).toEqual({
      ids: { user_id: "1", handle: "mop", token_state: "ok" },
      token: "22023: unknown_field",
      meta: {},
      audit: 1,
      moved: false,
    });
  });

  it("put_channel_ids with an agent's id named as a human raises 42501 and writes nothing (DB-04)", async () => {
    const result = await withRollback(async (db) => {
      const agent = await createStaffUser(db, ["media_ops"]);
      await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [
        agent,
      ]);
      return {
        refused: await refusal(
          db,
          `select public.put_channel_ids('x', '{"handle":"mop"}', $1, 'human', 'req')`,
          [agent],
        ),
        x: await scalar<unknown>(db, "select value as v from public.settings where key = 'x'"),
      };
    });
    expect(result).toEqual({
      refused: "42501: forbidden",
      x: {},
    });
  });

  it("record_channel_usage counts the month's reads and starts again in a new month", async () => {
    const result = await withRollback(async (db) => {
      const add = () => scalar<number>(db, "select public.record_channel_usage('x', 3) as v");
      const first = [await add(), await add()];
      await db.query(
        `update public.settings set value = value || '{"usage":{"month":"2000-01","reads":40}}' where key = 'x'`,
      );
      return { first, fresh: await add() };
    });
    expect(result).toEqual({ first: [3, 6], fresh: 3 });
  });

  it("store_channel_token stores a set once, answers stale for the old refresh token, and audits the rotation", async () => {
    const result = await withRollback(async (db) => {
      const empty = await scalar<string>(
        db,
        "select public.store_channel_token('x', 'seed-hash', $1) as v",
        [
          JSON.stringify({
            access_token: "a1",
            refresh_token: "r1",
            expires_at: "2026-10-06T16:00:00Z",
          }),
        ],
      );
      const stale = await scalar<string>(
        db,
        "select public.store_channel_token('x', 'seed-hash', $1) as v",
        [
          JSON.stringify({
            access_token: "a2",
            refresh_token: "r2",
            expires_at: "2026-10-06T18:00:00Z",
          }),
        ],
      );
      const vault = await scalar<string>(
        db,
        "select public.get_vault_secret('x_oauth_token') as v",
      );
      return {
        empty,
        stale,
        vault: JSON.parse(vault) as unknown,
        audit: await auditRows(db, "secret.rotated"),
      };
    });
    expect(result.empty).toBe("stored");
    expect(result.stale).toBe("stale");
    expect(result.vault).toMatchObject({ access_token: "a1", refresh_token: "r1" });
    expect(result.audit.filter((row) => row.entity === "X_ACCESS_TOKEN")).toEqual([
      {
        actor_id: null,
        actor_kind: null,
        note: "X_ACCESS_TOKEN: automatic refresh",
        entity: "X_ACCESS_TOKEN",
      },
    ]);
  });

  it("store_channel_token answers busy on a second connection while the first holds the lock", async () => {
    const set = JSON.stringify({
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-10-06T16:00:00Z",
    });
    const answers = await withRollback(async (first) => {
      const held = await scalar<string>(
        first,
        "select public.store_channel_token('linkedin', 'h', $1) as v",
        [set],
      );
      const other = await withRollback((second) =>
        scalar<string>(second, "select public.store_channel_token('linkedin', 'h', $1) as v", [
          set,
        ]),
      );
      return [held, other];
    });
    expect(answers).toEqual(["stored", "busy"]);
  });
});

describe("campaign reports (G22)", () => {
  /** A campaign of a published property, with its submission unless `submission` is false. */
  async function campaign(db: Db, n: number, submission = true): Promise<string> {
    const subject = await property(db, n);
    const payment = await createInvoice(db, {
      submission: subject.submission ?? "",
      status: "paid",
      n,
    });
    return scalar<string>(
      db,
      `insert into public.campaigns (property_id, submission_id, payment_id, package)
       values ($1, $2, $3, 'The Feature') returning id as v`,
      [subject.id, submission ? subject.submission : null, payment],
    );
  }

  it("a second upsert_campaign_report for the same week leaves one row", async () => {
    const rows = await withRollback(async (db) => {
      const id = await campaign(db, 9614);
      await db.query(`select public.upsert_campaign_report($1, '2026-10-05', '{"reach":10}')`, [
        id,
      ]);
      await db.query(`select public.upsert_campaign_report($1, '2026-10-05', '{"reach":12}')`, [
        id,
      ]);
      return (
        await db.query<{ reach: string }>(
          "select reach from public.campaign_reports where campaign_id = $1",
          [id],
        )
      ).rows;
    });
    expect(rows).toEqual([{ reach: "12" }]);
  });

  it("email_campaign_report twice in one minute makes one send_email job and one reports.email row", async () => {
    const result = await withRollback(async (db) => {
      const id = await campaign(db, 9615);
      const actor = await createStaffUser(db, ["managing_editor"]);
      const report = await scalar<string>(
        db,
        `select public.upsert_campaign_report($1, '2026-10-05', '{}') as v`,
        [id],
      );
      const send = () =>
        scalar<string | null>(
          db,
          "select public.email_campaign_report($1, $2, 'human', 'req') as v",
          [report, actor],
        );
      const jobs = [await send(), await send()];
      const template = await scalar<string>(
        db,
        "select payload -> 'params' ->> 'template' as v from public.jobs where id = $1",
        [jobs[0]],
      );
      const lonely = await campaign(db, 9616, false);
      const orphan = await scalar<string>(
        db,
        `select public.upsert_campaign_report($1, '2026-10-05', '{}') as v`,
        [lonely],
      );
      return {
        made: jobs.filter((job) => job !== null).length,
        template,
        audit: (await auditRows(db, "reports.email", report)).length,
        missing: await refusal(db, "select public.email_campaign_report($1, $2, 'human', 'req')", [
          orphan,
          actor,
        ]),
      };
    });
    expect(result).toEqual({
      made: 1,
      template: "campaign_report",
      audit: 1,
      missing: "22023: recipient_missing",
    });
  });
});

describe("complete_distributed_submissions (G60, DL-09)", () => {
  type Campaign = "ended" | "tomorrow" | "open" | "none";

  /** A submission in `state` with a property published `days` days ago and a campaign row of the given kind. */
  async function distributed(
    db: Db,
    n: number,
    state: "Published" | "Distribution Active",
    days: number,
    kind: Campaign,
  ): Promise<string> {
    const submission = await createSubmission(db, { state, n, base: await dbNow(db) });
    const subject = await publishedProperty(db, { n, submission_id: submission });
    await db.query(
      "update public.properties set published_at = now() - make_interval(days => $2) where id = $1",
      [subject.id, days],
    );
    if (kind !== "none") {
      const payment = await createInvoice(db, { submission, status: "paid", n });
      const endsOn = {
        ended: "(now() at time zone 'utc')::date - 1",
        tomorrow: "(now() at time zone 'utc')::date + 1",
        open: "null",
      }[kind];
      await db.query(
        `insert into public.campaigns (property_id, submission_id, payment_id, package, ends_on)
         values ($1, $2, $3, 'The Feature', ${endsOn})`,
        [subject.id, submission, payment],
      );
    }
    return submission;
  }

  it("completes what is due, leaves what is not, and counts the moves", async () => {
    const result = await withRollback(async (db) => {
      // Rows already due on the database are moved first, so the count below is this test's own.
      await db.query("select public.complete_distributed_submissions(now())");
      const due = [
        await distributed(db, 9650, "Distribution Active", 3, "ended"),
        await distributed(db, 9651, "Distribution Active", 31, "none"),
        await distributed(db, 9652, "Distribution Active", 31, "open"),
        await distributed(db, 9653, "Published", 3, "ended"),
      ];
      const kept = [
        await distributed(db, 9654, "Distribution Active", 31, "tomorrow"),
        await distributed(db, 9655, "Distribution Active", 29, "none"),
        await distributed(db, 9656, "Distribution Active", 29, "open"),
        await distributed(db, 9657, "Published", 3, "tomorrow"),
      ];
      const moved = await scalar<number>(
        db,
        "select public.complete_distributed_submissions(now()) as v",
      );
      const states = async (ids: string[]) =>
        (
          await db.query<{ v: string }>(
            "select workflow_state::text as v from public.submissions where id = any($1::uuid[]) order by id",
            [ids],
          )
        ).rows.map((row) => row.v);
      const again = await scalar<number>(
        db,
        "select public.complete_distributed_submissions(now()) as v",
      );
      return {
        moved,
        again,
        due: new Set(await states(due)),
        kept: new Set(await states(kept)),
      };
    });
    expect(result).toEqual({
      moved: 4,
      again: 0,
      due: new Set(["Completed"]),
      kept: new Set(["Distribution Active", "Published"]),
    });
  });
});

describe("the campaign_report template (G22, G46)", () => {
  it("is seeded enabled and transactional, with the copy and the variables of its definition", async () => {
    const row = await withRollback(
      async (db) =>
        (
          await db.query<Record<string, unknown>>(
            `select key, class, subject, preheader, body, variables, enabled
             from public.email_templates where key = 'campaign_report'`,
          )
        ).rows[0],
    );
    expect(row).toEqual({
      key: "campaign_report",
      class: "transactional",
      subject: definition.subject,
      preheader: definition.preheader,
      body: definition.blocks,
      variables: [...definition.variables],
      enabled: true,
    });
  });
});
