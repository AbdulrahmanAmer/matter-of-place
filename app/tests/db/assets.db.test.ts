// B9 step 7: the assets table and its functions (invariants 3, 4, 11 and 12 of the plan, ruling H34 (5), JOB-03). Every
// case runs in a rolled-back transaction through the harness (F22); the claim race is render-claim.db.test.ts.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

interface Refusal {
  code: string;
  message: string;
  detail: string;
}

/** Runs `sql` under a savepoint; the refusal, or null when it went through. The transaction stays usable. */
async function refusal(db: Db, sql: string, params: unknown[] = []): Promise<Refusal | null> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) {
      return { code: error.code ?? "", message: error.message, detail: error.detail ?? "" };
    }
    throw error;
  }
}

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

/** A draft property of `market` and `tier`; the markets are kept when a seed already holds them. */
async function property(
  db: Db,
  slug: string,
  tier = "Editorial",
  market = "california",
): Promise<string> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x'), ('florida', 'Florida', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  return scalar<string>(
    db,
    `insert into public.properties (slug, title, market_slug, city, state, address, type, campaign_tier)
     values ($1, 'Test house', $2, 'Berkeley', 'CA', '1 Test Way', 'Residence', $3::public.campaign_tier)
     returning id as v`,
    [slug, market, tier],
  );
}

const MAIN_FILE = `[{"media_key":"assets/p/cover/r1/cover.aaaaaaaa.jpg","w":1200,"h":630,"bytes":1,"role":"main"}]`;
const FILES: unknown = JSON.parse(MAIN_FILE);
const COMPLETE_MEDIA = `files = '${MAIN_FILE}', caption = 'A caption.', alt_text = 'A house.'`;
const BLOCK = `{"title":"t","deck":"d","image_key":"o/p/0-aaaaaaaa.webp","image_url":"https://x.test/media/k","link":"https://x.test/p"}`;
const COMPLETE_BLOCK = `meta = '{"block":${BLOCK}}', alt_text = 'A house.'`;
const COMPLETE_EMAIL = `meta = '{"subject":"s","preheader":"p","block":{"title":"t"}}'`;
// B12's trigger assets_reel_video attaches an approved reel to the dossier and needs its video, poster and duration.
const REEL_FILES = `[{"media_key":"assets/p/reel/r1/reel.aaaaaaaa.mp4","w":1080,"h":1920,"bytes":1,"role":"video"},{"media_key":"assets/p/reel/r1/poster.aaaaaaaa.jpg","w":1080,"h":1920,"bytes":1,"role":"poster"}]`;
const COMPLETE_REEL = `files = '${REEL_FILES}', caption = 'A caption.', alt_text = 'A house.', meta = '{"duration_s":18}'`;

/** A stub of `kind` at revision 1 made through `upsert_asset_stub`, then `set` applied (a fixed SQL fragment). */
async function asset(db: Db, propertyId: string, kind: string, set = ""): Promise<string> {
  const id = await scalar<string>(
    db,
    "select (public.upsert_asset_stub($1, $2::public.asset_kind, 1, null)).id as v",
    [propertyId, kind],
  );
  if (set !== "") await db.query(`update public.assets set ${set} where id = $1`, [id]);
  return id;
}

async function human(db: Db): Promise<string> {
  return createStaffUser(db, ["media_ops"]);
}

const approve = (kind: "human" | "agent" = "human") =>
  `select public.approve_asset($1, $2, '${kind}'::public.actor_kind, 'req-1') as v`;

async function counts(db: Db, assetId: string): Promise<{ audit: number; events: number }> {
  return {
    audit: await scalar<number>(
      db,
      "select count(*)::int as v from public.audit_log where entity = 'assets' and entity_id = $1",
      [assetId],
    ),
    events: await scalar<number>(
      db,
      "select count(*)::int as v from public.events where entity = 'asset' and entity_id = $1",
      [assetId],
    ),
  };
}

const guards = [
  { kind: "cover", ready: COMPLETE_MEDIA, broken: "files = '[]'", missing: "files" },
  { kind: "carousel", ready: COMPLETE_MEDIA, broken: "caption = ' '", missing: "caption" },
  { kind: "story", ready: COMPLETE_MEDIA, broken: "alt_text = null", missing: "alt_text" },
  { kind: "reel", ready: COMPLETE_REEL, broken: "files = '[]'", missing: "files" },
  {
    kind: "newsletter_block",
    ready: COMPLETE_BLOCK,
    broken: `meta = '{"block":${BLOCK.replace(/"image_url":"[^"]*",/, "")}}'`,
    missing: "meta.block.image_url",
  },
  {
    kind: "standalone_email",
    ready: COMPLETE_EMAIL,
    broken: `meta = '{"subject":"s","block":{"title":"t"}}'`,
    missing: "meta.preheader",
  },
] as const;

describe("the approval guard", () => {
  it.each(guards)("$kind approves when complete and is refused when it is not", async (guard) => {
    const result = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-guard"), guard.kind, guard.ready);
      const refused = await refusal(
        db,
        `update public.assets set status = 'approved', ${guard.broken} where id = $1`,
        [id],
      );
      const passed = await refusal(
        db,
        "update public.assets set status = 'approved' where id = $1",
        [id],
      );
      return { refused, passed };
    });
    expect(result.refused).toMatchObject({
      code: "23514",
      message: "asset_incomplete",
      detail: guard.missing,
    });
    expect(result.passed).toBeNull();
  });

  it("refuses an approval whose caption_lint is failed", async () => {
    const refused = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-lint"), "cover", COMPLETE_MEDIA);
      return refusal(
        db,
        `update public.assets set status = 'approved', meta = meta || '{"caption_lint":"failed"}' where id = $1`,
        [id],
      );
    });
    expect(refused).toMatchObject({ code: "23514", message: "caption_lint_failed" });
  });

  it("refuses a reject without a note and accepts one with a note", async () => {
    const result = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-note"), "story");
      const bare = await refusal(db, "update public.assets set status = 'rejected' where id = $1", [
        id,
      ]);
      const blank = await refusal(
        db,
        "update public.assets set status = 'rejected', rejection_note = '  ' where id = $1",
        [id],
      );
      const noted = await refusal(
        db,
        "update public.assets set status = 'rejected', rejection_note = 'Too dark.' where id = $1",
        [id],
      );
      return { bare, blank, noted };
    });
    expect(result.bare).toMatchObject({ code: "23514", message: "rejection_note_required" });
    expect(result.blank).toMatchObject({ code: "23514", message: "rejection_note_required" });
    expect(result.noted).toBeNull();
  });
});

describe("approve_asset", () => {
  it("writes one audit row and one asset.approved event with the property's tier and market", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-approve", "Campaign", "florida");
      const id = await asset(db, propertyId, "cover", COMPLETE_MEDIA);
      const actor = await human(db);
      const eventId = await scalar<string>(db, approve(), [id, actor]);
      const event = await db.query<{
        id: string;
        type: string;
        payload: unknown;
        actor_id: string;
      }>(
        "select id, type, payload, actor_id from public.events where entity = 'asset' and entity_id = $1",
        [id],
      );
      const row = await db.query<{ status: string; approved_by: string; approved_at: Date | null }>(
        "select status, approved_by, approved_at from public.assets where id = $1",
        [id],
      );
      return {
        eventId,
        event: event.rows,
        row: row.rows[0],
        counts: await counts(db, id),
        propertyId,
        id,
        actor,
      };
    });
    expect(result.counts).toEqual({ audit: 1, events: 1 });
    expect(result.event).toEqual([
      {
        id: result.eventId,
        type: "asset.approved",
        actor_id: result.actor,
        payload: {
          asset_id: result.id,
          property_id: result.propertyId,
          kind: "cover",
          tier: "Campaign",
          market: "florida",
        },
      },
    ]);
    expect(result.row).toMatchObject({ status: "approved", approved_by: result.actor });
    expect(result.row?.approved_at).not.toBeNull();
  });

  it("a refused approval writes no audit row and no event", async () => {
    const result = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-refused"), "cover");
      const refused = await refusal(db, approve(), [id, await human(db)]);
      return { refused, counts: await counts(db, id) };
    });
    expect(result.refused).toMatchObject({ code: "23514", message: "asset_incomplete" });
    expect(result.counts).toEqual({ audit: 0, events: 0 });
  });

  it("refuses an agent with manual_approval and changes nothing", async () => {
    const result = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-agent"), "cover", COMPLETE_MEDIA);
      const refused = await refusal(db, approve("agent"), [id, await human(db)]);
      const status = await scalar<string>(
        db,
        "select status::text as v from public.assets where id = $1",
        [id],
      );
      return { refused, status, counts: await counts(db, id) };
    });
    expect(result.refused).toMatchObject({ code: "42501", message: "manual_approval" });
    expect(result.status).toBe("pending");
    expect(result.counts).toEqual({ audit: 0, events: 0 });
  });

  it("refuses an asset that is not pending", async () => {
    const refused = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-twice"), "cover", COMPLETE_MEDIA);
      const actor = await human(db);
      await db.query(approve(), [id, actor]);
      return refusal(db, approve(), [id, actor]);
    });
    expect(refused).toMatchObject({ code: "55000", message: "asset_not_pending" });
  });

  it("an approved cover sets og_image_key to its main file and an approved story leaves it", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-og");
      const key = (): Promise<string | null> =>
        scalar<string | null>(db, "select og_image_key as v from public.properties where id = $1", [
          propertyId,
        ]);
      const actor = await human(db);
      await db.query("update public.properties set og_image_key = 'assets/old.jpg' where id = $1", [
        propertyId,
      ]);
      const story = await asset(db, propertyId, "story", COMPLETE_MEDIA);
      await db.query(approve(), [story, actor]);
      const afterStory = await key();
      const cover = await asset(db, propertyId, "cover", COMPLETE_MEDIA);
      await db.query(approve(), [cover, actor]);
      const afterCover = await key();
      return { afterStory, afterCover };
    });
    expect(result.afterStory).toBe("assets/old.jpg");
    expect(result.afterCover).toBe("assets/p/cover/r1/cover.aaaaaaaa.jpg");
  });

  it("a cover with no main file leaves og_image_key as it is", async () => {
    const key = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-og-none");
      await db.query("update public.properties set og_image_key = 'assets/old.jpg' where id = $1", [
        propertyId,
      ]);
      const cover = await asset(
        db,
        propertyId,
        "cover",
        `files = '[{"media_key":"k.jpg","w":1,"h":1,"bytes":1,"role":"x"}]', caption = 'c', alt_text = 'a'`,
      );
      await db.query(approve(), [cover, await human(db)]);
      return scalar<string | null>(
        db,
        "select og_image_key as v from public.properties where id = $1",
        [propertyId],
      );
    });
    expect(key).toBe("assets/old.jpg");
  });
});

describe("reject_asset", () => {
  const reject = "select public.reject_asset($1, $2, $3, 'human'::public.actor_kind, 'req-2') as v";

  it("with a note writes one asset.rejected event carrying the note and one audit row", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-reject", "Feature", "florida");
      const id = await asset(db, propertyId, "story", COMPLETE_MEDIA);
      await db.query(reject, [id, "Too dark.", await human(db)]);
      const event = await db.query<{ type: string; payload: unknown }>(
        "select type, payload from public.events where entity = 'asset' and entity_id = $1",
        [id],
      );
      const row = await db.query<{ status: string; rejection_note: string }>(
        "select status, rejection_note from public.assets where id = $1",
        [id],
      );
      return { event: event.rows, row: row.rows[0], counts: await counts(db, id), propertyId, id };
    });
    expect(result.event).toEqual([
      {
        type: "asset.rejected",
        payload: {
          asset_id: result.id,
          property_id: result.propertyId,
          kind: "story",
          tier: "Feature",
          market: "florida",
          note: "Too dark.",
        },
      },
    ]);
    expect(result.row).toEqual({ status: "rejected", rejection_note: "Too dark." });
    expect(result.counts).toEqual({ audit: 1, events: 1 });
  });

  it("without a note is refused and writes nothing", async () => {
    const result = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-reject-bare"), "story");
      const refused = await refusal(db, reject, [id, null, await human(db)]);
      return { refused, counts: await counts(db, id) };
    });
    expect(result.refused).toMatchObject({ code: "23514", message: "rejection_note_required" });
    expect(result.counts).toEqual({ audit: 0, events: 0 });
  });

  it("refuses an asset that is already rejected", async () => {
    const refused = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-reject-twice"), "story");
      const actor = await human(db);
      await db.query(reject, [id, "No.", actor]);
      return refusal(db, reject, [id, "Again.", actor]);
    });
    expect(refused).toMatchObject({ code: "55000", message: "asset_not_rejectable" });
  });
});

describe("rerender_asset", () => {
  const rerender = "select public.rerender_asset($1, $2, 'human'::public.actor_kind, 'req-3') as v";

  interface JobRow {
    type: string;
    idempotency_key: string;
    heavy: boolean;
    payload: unknown;
  }

  async function jobOf(db: Db, id: string): Promise<JobRow> {
    const row = (
      await db.query<JobRow>(
        "select type, idempotency_key, heavy, payload from public.jobs where id = $1",
        [id],
      )
    ).rows[0];
    if (row === undefined) throw new Error("no job row");
    return row;
  }

  it("makes revision 2 with the copied text, supersedes revision 1 and creates one heavy job", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-rerender", "Campaign", "florida");
      const first = await asset(
        db,
        propertyId,
        "cover",
        `${COMPLETE_MEDIA}, meta = '{"captions":{"instagram":"i","x":"x","linkedin":"l"},"slide_alts":["a"],"max_slides":7,"caption_lint":"passed","spec_hash":"old"}'`,
      );
      const made = await scalar<{ asset_id: string; job_id: string }>(db, rerender, [
        first,
        await human(db),
      ]);
      const second = await db.query<Record<string, unknown>>(
        `select revision, status, caption, alt_text, meta, job_id, files from public.assets where id = $1`,
        [made.asset_id],
      );
      const old = await db.query<Record<string, unknown>>(
        "select status, rejection_note from public.assets where id = $1",
        [first],
      );
      const jobs = await db.query<{ n: number }>(
        "select count(*)::int as n from public.jobs where idempotency_key like $1",
        [`render_cover:${propertyId}:%`],
      );
      return {
        made,
        second: second.rows[0],
        old: old.rows[0],
        job: await jobOf(db, made.job_id),
        jobs: jobs.rows[0]?.n,
        propertyId,
        audit: await scalar<number>(
          db,
          "select count(*)::int as v from public.audit_log where action = 'assets.re_render' and entity_id = $1",
          [made.asset_id],
        ),
      };
    });
    expect(result.second).toEqual({
      revision: 2,
      status: "pending",
      caption: "A caption.",
      alt_text: "A house.",
      meta: {
        captions: { instagram: "i", x: "x", linkedin: "l" },
        slide_alts: ["a"],
        max_slides: 7,
        caption_lint: "passed",
      },
      job_id: result.made.job_id,
      files: [],
    });
    expect(result.old).toEqual({ status: "rejected", rejection_note: "superseded" });
    expect(result.job).toEqual({
      type: "render_cover",
      idempotency_key: `render_cover:${result.propertyId}:2`,
      heavy: true,
      payload: {
        params: {},
        data: {
          property_id: result.propertyId,
          slug: "test-b9-rerender",
          tier: "Campaign",
          market: "florida",
          revision: 2,
        },
      },
    });
    expect(result.jobs).toBe(1);
    expect(result.audit).toBe(1);
  });

  it("answers a second call on the old revision with the new revision and its job", async () => {
    const result = await withRollback(async (db) => {
      const first = await asset(db, await property(db, "test-b9-rerender-twice"), "story");
      const actor = await human(db);
      const one = await scalar<{ asset_id: string; job_id: string }>(db, rerender, [first, actor]);
      const two = await scalar<{ asset_id: string; job_id: string }>(db, rerender, [first, actor]);
      const jobs = await scalar<number>(
        db,
        "select count(*)::int as v from public.jobs where type = 'render_story' and payload -> 'data' ->> 'slug' = 'test-b9-rerender-twice'",
      );
      return { one, two, jobs };
    });
    expect(result.two).toEqual(result.one);
    expect(result.jobs).toBe(1);
  });

  it("re-rendering the latest revision makes the next one", async () => {
    const revisions = await withRollback(async (db) => {
      const first = await asset(db, await property(db, "test-b9-rerender-next"), "story");
      const actor = await human(db);
      const one = await scalar<{ asset_id: string }>(db, rerender, [first, actor]);
      await scalar(db, rerender, [one.asset_id, actor]);
      return (
        await db.query<{ revision: number; status: string }>(
          "select revision, status from public.assets where property_id = (select property_id from public.assets where id = $1) order by revision",
          [first],
        )
      ).rows;
    });
    expect(revisions).toEqual([
      { revision: 1, status: "rejected" },
      { revision: 2, status: "rejected" },
      { revision: 3, status: "pending" },
    ]);
  });

  it("creates a light job for a newsletter_block and keys each newsletter kind with its own name", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-rerender-news", "Campaign");
      const actor = await human(db);
      const block = await asset(db, propertyId, "newsletter_block");
      const email = await asset(db, propertyId, "standalone_email");
      const first = await scalar<{ job_id: string }>(db, rerender, [block, actor]);
      const second = await scalar<{ job_id: string }>(db, rerender, [email, actor]);
      return { propertyId, a: await jobOf(db, first.job_id), b: await jobOf(db, second.job_id) };
    });
    const data = (kind: string) => ({
      property_id: result.propertyId,
      slug: "test-b9-rerender-news",
      tier: "Campaign",
      market: "california",
      revision: 2,
      kind,
    });
    expect(result.a).toEqual({
      type: "build_newsletter_block",
      idempotency_key: `build_newsletter_block:${result.propertyId}:newsletter_block:2`,
      heavy: false,
      payload: { params: {}, data: data("newsletter_block") },
    });
    expect(result.b).toEqual({
      type: "build_newsletter_block",
      idempotency_key: `build_newsletter_block:${result.propertyId}:standalone_email:2`,
      heavy: false,
      payload: { params: {}, data: data("standalone_email") },
    });
  });

  it("refuses a kind that has no job type", async () => {
    const refused = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-rerender-variants"), "variants");
      return refusal(db, rerender, [id, await human(db)]);
    });
    expect(refused).toMatchObject({ code: "22023", message: "invalid_kind" });
  });
});

describe("set_asset_caption", () => {
  const caption = (captions: string) =>
    `select public.set_asset_caption($1, $3, 'human'::public.actor_kind, '${captions}'::jsonb, $2, 'req-4') as v`;

  async function writeCaptionsJob(
    db: Db,
    propertyId: string,
    status: "queued" | "running",
  ): Promise<string> {
    const id = await scalar<string>(
      db,
      `select public.enqueue_job('write_captions', $2::jsonb, $1, p_local => true) as v`,
      [`test:${randomUUID()}`, JSON.stringify({ params: {}, data: { property_id: propertyId } })],
    );
    if (status === "running") {
      await db.query(
        "update public.jobs set status = 'running', locked_by = 'claim' where id = $1",
        [id],
      );
    }
    return id;
  }

  it("marks the caption edited, merges the variants and mirrors the Instagram one", async () => {
    const row = await withRollback(async (db) => {
      const id = await asset(
        db,
        await property(db, "test-b9-caption"),
        "cover",
        `caption = 'old', alt_text = 'old alt', meta = '{"captions":{"instagram":"old","x":"x","linkedin":"l"},"caption_lint":"passed"}'`,
      );
      await db.query(caption('{"instagram":"new"}'), [id, "New alt.", await human(db)]);
      return (
        await db.query<Record<string, unknown>>(
          "select caption, alt_text, meta from public.assets where id = $1",
          [id],
        )
      ).rows[0];
    });
    expect(row).toEqual({
      caption: "new",
      alt_text: "New alt.",
      meta: { captions: { instagram: "new", x: "x", linkedin: "l" }, caption_lint: "edited" },
    });
  });

  it("accepts an edit while the asset is pending and refuses it once a person approved it", async () => {
    const result = await withRollback(async (db) => {
      const id = await asset(
        db,
        await property(db, "test-b9-caption-approved"),
        "cover",
        COMPLETE_MEDIA,
      );
      const actor = await human(db);
      const pending = await refusal(db, caption('{"instagram":"first"}'), [id, null, actor]);
      await db.query(approve(), [id, actor]);
      const approved = await refusal(db, caption('{"instagram":"second"}'), [
        id,
        "Other alt.",
        actor,
      ]);
      const row = (
        await db.query<Record<string, unknown>>(
          "select caption, alt_text from public.assets where id = $1",
          [id],
        )
      ).rows[0];
      const audited = await scalar<number>(
        db,
        "select count(*)::int as v from public.audit_log where entity_id = $1 and action = 'assets.caption'",
        [id],
      );
      return { pending, approved, row, audited };
    });
    expect(result).toEqual({
      pending: null,
      approved: { code: "55000", message: "wrong_state", detail: "" },
      row: { caption: "first", alt_text: "A house." },
      audited: 1,
    });
  });

  it("completes a queued write_captions job of the property and leaves a running one", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-caption-job");
      const other = await property(db, "test-b9-caption-other");
      const id = await asset(db, propertyId, "cover");
      const queued = await writeCaptionsJob(db, propertyId, "queued");
      const running = await writeCaptionsJob(db, propertyId, "running");
      const elsewhere = await writeCaptionsJob(db, other, "queued");
      await db.query(caption('{"instagram":"typed"}'), [id, null, await human(db)]);
      const state = async (job: string) =>
        (
          await db.query<{ status: string; result: unknown }>(
            "select status, result from public.jobs where id = $1",
            [job],
          )
        ).rows[0];
      const event = await scalar<number>(
        db,
        "select count(*)::int as v from public.job_events where job_id = $1 and kind = 'done'",
        [queued],
      );
      return {
        queued: await state(queued),
        running: await state(running),
        elsewhere: await state(elsewhere),
        event,
      };
    });
    expect(result.queued).toEqual({ status: "done", result: { manual: true } });
    expect(result.running).toEqual({ status: "running", result: null });
    expect(result.elsewhere).toEqual({ status: "queued", result: null });
    expect(result.event).toBe(1);
  });
});

describe("assets_job_error", () => {
  it.each(["failed", "dead"] as const)(
    "a job moved to %s sets render_error on its asset",
    async (status) => {
      const row = await withRollback(async (db) => {
        const propertyId = await property(db, `test-b9-error-${status}`);
        const jobId = await scalar<string>(
          db,
          "select public.enqueue_job('render_cover', '{}', $1) as v",
          [`test:${randomUUID()}`],
        );
        const stub = await scalar<string>(
          db,
          "select (public.upsert_asset_stub($1, 'cover', 1, $2)).id as v",
          [propertyId, jobId],
        );
        await db.query(
          "update public.jobs set status = $2::public.job_status, error = 'chrome_crashed' where id = $1",
          [jobId, status],
        );
        return (
          await db.query<{ render_error: string | null }>(
            "select render_error from public.assets where id = $1",
            [stub],
          )
        ).rows[0];
      });
      expect(row).toEqual({ render_error: "chrome_crashed" });
    },
  );

  it("deleting the job leaves the asset with a null job_id", async () => {
    const row = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-job-delete");
      const jobId = await scalar<string>(
        db,
        "select public.enqueue_job('render_cover', '{}', $1) as v",
        [`test:${randomUUID()}`],
      );
      const stub = await scalar<string>(
        db,
        "select (public.upsert_asset_stub($1, 'cover', 1, $2)).id as v",
        [propertyId, jobId],
      );
      await db.query("select set_config('mop.retention', 'on', true)");
      await db.query("delete from public.jobs where id = $1", [jobId]);
      return (
        await db.query<{ job_id: string | null }>(
          "select job_id from public.assets where id = $1",
          [stub],
        )
      ).rows[0];
    });
    expect(row).toEqual({ job_id: null });
  });
});

describe("the seed", () => {
  it("holds the caption model", async () => {
    const value = await withRollback((db) =>
      scalar<unknown>(db, "select value as v from public.settings where key = 'caption_model'"),
    );
    expect(value).toBe("claude-haiku-4-5-20251001");
  });
});

describe("upsert_asset_stub", () => {
  it("called twice gives one row, and a second insert of the same revision is a unique violation", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-stub");
      const one = await asset(db, propertyId, "cover");
      const two = await asset(db, propertyId, "cover");
      const rows = await scalar<number>(
        db,
        "select count(*)::int as v from public.assets where property_id = $1",
        [propertyId],
      );
      const duplicate = await refusal(
        db,
        "insert into public.assets (property_id, kind, revision) values ($1, 'cover', 1)",
        [propertyId],
      );
      return { same: one === two, rows, duplicate };
    });
    expect(result.same).toBe(true);
    expect(result.rows).toBe(1);
    expect(result.duplicate).toMatchObject({ code: "23505" });
  });

  it("starts the next revision when every revision was rejected", async () => {
    const revisions = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-stub-rejected");
      await asset(db, propertyId, "story", "status = 'rejected', rejection_note = 'No.'");
      await db.query("select public.upsert_asset_stub($1, 'story', null, null)", [propertyId]);
      return (
        await db.query<{ revision: number; status: string }>(
          "select revision, status from public.assets where property_id = $1 order by revision",
          [propertyId],
        )
      ).rows;
    });
    expect(revisions).toEqual([
      { revision: 1, status: "rejected" },
      { revision: 2, status: "pending" },
    ]);
  });

  it("gives a pending stub the new job and an approved one keeps its own", async () => {
    const result = await withRollback(async (db) => {
      const propertyId = await property(db, "test-b9-stub-job");
      const job = (): Promise<string> =>
        scalar<string>(db, "select public.enqueue_job('render_cover', '{}', $1) as v", [
          `test:${randomUUID()}`,
        ]);
      const [first, second, third] = [await job(), await job(), await job()];
      const jobOf = (id: string): Promise<string | null> =>
        scalar<string | null>(db, "select job_id as v from public.assets where id = $1", [id]);
      const id = await scalar<string>(
        db,
        "select (public.upsert_asset_stub($1, 'cover', 1, $2)).id as v",
        [propertyId, first],
      );
      await db.query("select public.upsert_asset_stub($1, 'cover', 1, $2)", [propertyId, second]);
      const pending = await jobOf(id);
      await db.query(
        `update public.assets set ${COMPLETE_MEDIA}, status = 'approved' where id = $1`,
        [id],
      );
      await db.query("select public.upsert_asset_stub($1, 'cover', 1, $2)", [propertyId, third]);
      return { pending, approved: await jobOf(id), second };
    });
    expect(result.pending).toBe(result.second);
    expect(result.approved).toBe(result.second);
  });
});

describe("set_asset_files and set_asset_text", () => {
  it("set_asset_files fills files and meta.spec_hash, keeps the other meta keys and clears render_error", async () => {
    const row = await withRollback(async (db) => {
      const id = await asset(
        db,
        await property(db, "test-b9-files"),
        "cover",
        `render_error = 'chrome_crashed', meta = '{"captions":{"instagram":"i"}}'`,
      );
      await db.query("select public.set_asset_files($1, $2::jsonb, 'hash1')", [id, MAIN_FILE]);
      return (
        await db.query<Record<string, unknown>>(
          "select files, meta, render_error from public.assets where id = $1",
          [id],
        )
      ).rows[0];
    });
    expect(row).toEqual({
      files: FILES,
      meta: { captions: { instagram: "i" }, spec_hash: "hash1" },
      render_error: null,
    });
  });

  it("set_asset_files names an unknown asset", async () => {
    const refused = await withRollback((db) =>
      refusal(db, "select public.set_asset_files($1, '[]', 'h')", [randomUUID()]),
    );
    expect(refused).toMatchObject({ code: "P0002", message: "not_found" });
  });

  it("set_asset_text keeps an existing max_slides and a null alt text", async () => {
    const row = await withRollback(async (db) => {
      const id = await asset(
        db,
        await property(db, "test-b9-text"),
        "carousel",
        `alt_text = 'kept', meta = '{"max_slides":8}'`,
      );
      await db.query(
        `select public.set_asset_text($1, 'Caption.', null, '{"max_slides":6,"slide_alts":["a"]}'::jsonb)`,
        [id],
      );
      return (
        await db.query<Record<string, unknown>>(
          "select caption, alt_text, meta from public.assets where id = $1",
          [id],
        )
      ).rows[0];
    });
    expect(row).toEqual({
      caption: "Caption.",
      alt_text: "kept",
      meta: { max_slides: 8, slide_alts: ["a"] },
    });
  });

  it("set_asset_text writes max_slides when meta has none", async () => {
    const meta = await withRollback(async (db) => {
      const id = await asset(db, await property(db, "test-b9-text-first"), "carousel");
      await db.query(`select public.set_asset_text($1, null, null, '{"max_slides":6}'::jsonb)`, [
        id,
      ]);
      return scalar<unknown>(db, "select meta as v from public.assets where id = $1", [id]);
    });
    expect(meta).toEqual({ max_slides: 6 });
  });
});

const SIZES = {
  thumb: { w: 320, h: 427 },
  card: { w: 720, h: 960 },
  hero: { w: 1200, h: 1600 },
  og: { w: 1200, h: 630 },
  carousel: { w: 1080, h: 1350 },
};
const VARIANTS = JSON.stringify(SIZES);

/** `count` staged rows of one property, in sort order; each id is returned with its staging path. */
async function staged(
  db: Db,
  propertyId: string,
  count = 1,
): Promise<{ id: string; staging_path: string }[]> {
  return (
    await db.query<{ id: string; staging_path: string }>(
      `insert into public.property_media (property_id, staging_path, sort_order)
       select $1::uuid, 'staging/' || $1::text || '/' || n || '.jpg', n from generate_series(0, $2::int - 1) n
       returning id, staging_path`,
      [propertyId, count],
    )
  ).rows;
}

describe("apply_media_variants and clear_media_staging", () => {
  const apply = "select public.apply_media_variants($1::jsonb) as v";

  async function mediaRow(db: Db, id: string): Promise<Record<string, unknown>> {
    const row = (
      await db.query<Record<string, unknown>>(
        "select media_key, variants, orientation, staging_path, render_job_id from public.property_media where id = $1",
        [id],
      )
    ).rows[0];
    if (row === undefined) throw new Error("no media row");
    return row;
  }

  it("stores the key and the variants of a staged row and leaves the orientation to B2's trigger", async () => {
    const result = await withRollback(async (db) => {
      const [row] = await staged(db, await property(db, "test-b9-apply"));
      if (row === undefined) throw new Error("no staged row");
      const items = [
        {
          media_id: row.id,
          staging_path: row.staging_path,
          media_key: "o/p/0-aaaaaaaa.webp",
          variants: SIZES,
        },
      ];
      return {
        returned: await scalar<unknown>(db, apply, [JSON.stringify(items)]),
        stored: await mediaRow(db, row.id),
        row,
      };
    });
    expect(result.returned).toEqual([
      { media_id: result.row.id, staging_path: result.row.staging_path, stored: true },
    ]);
    expect(result.stored).toEqual({
      media_key: "o/p/0-aaaaaaaa.webp",
      variants: SIZES,
      orientation: "portrait",
      staging_path: result.row.staging_path,
      render_job_id: null,
    });
  });

  it("an item with another path returns stored false and changes nothing", async () => {
    const result = await withRollback(async (db) => {
      const [row] = await staged(db, await property(db, "test-b9-apply-path"));
      if (row === undefined) throw new Error("no staged row");
      const items = [
        {
          media_id: row.id,
          staging_path: "staging/other.jpg",
          media_key: "o/p/0-bbbbbbbb.webp",
          variants: SIZES,
        },
      ];
      return {
        returned: await scalar<unknown>(db, apply, [JSON.stringify(items)]),
        stored: await mediaRow(db, row.id),
        row,
      };
    });
    expect(result.returned).toEqual([
      { media_id: result.row.id, staging_path: "staging/other.jpg", stored: false },
    ]);
    expect(result.stored).toMatchObject({
      media_key: null,
      variants: {},
      staging_path: result.row.staging_path,
    });
  });

  it("the same media_key keeps the other sizes and replaces the one given", async () => {
    const variants = await withRollback(async (db) => {
      const [row] = await staged(db, await property(db, "test-b9-apply-merge"));
      if (row === undefined) throw new Error("no staged row");
      const item = (v: unknown) =>
        JSON.stringify([
          {
            media_id: row.id,
            staging_path: row.staging_path,
            media_key: "o/p/0-aaaaaaaa.webp",
            variants: v,
          },
        ]);
      await db.query(apply, [item(SIZES)]);
      await db.query(apply, [item({ og: { w: 1200, h: 631 } })]);
      return (await mediaRow(db, row.id))["variants"];
    });
    expect(variants).toEqual({ ...SIZES, og: { w: 1200, h: 631 } });
  });

  it("another media_key drops the old sizes", async () => {
    const variants = await withRollback(async (db) => {
      const [row] = await staged(db, await property(db, "test-b9-apply-replace"));
      if (row === undefined) throw new Error("no staged row");
      const item = (key: string, v: unknown) =>
        JSON.stringify([
          { media_id: row.id, staging_path: row.staging_path, media_key: key, variants: v },
        ]);
      await db.query(apply, [item("o/p/0-aaaaaaaa.webp", SIZES)]);
      await db.query(apply, [item("o/p/0-cccccccc.webp", { og: { w: 1200, h: 630 } })]);
      return (await mediaRow(db, row.id))["variants"];
    });
    expect(variants).toEqual({ og: { w: 1200, h: 630 } });
  });

  it("updates 40 rows in one call and clear_media_staging clears the stored ones", async () => {
    const result = await withRollback(async (db) => {
      const rows = await staged(db, await property(db, "test-b9-apply-forty"), 40);
      const items = rows.map((row) => ({
        media_id: row.id,
        staging_path: row.staging_path,
        media_key: `o/p/${row.id}.webp`,
        variants: SIZES,
      }));
      const returned = await scalar<{ stored: boolean }[]>(db, apply, [JSON.stringify(items)]);
      const [first, ...rest] = rows;
      if (first === undefined) throw new Error("no rows");
      await db.query(
        "update public.property_media set render_job_id = gen_random_uuid() where id = any($1::uuid[])",
        [rows.map((row) => row.id)],
      );
      const cleared = await scalar<number>(
        db,
        "select public.clear_media_staging($1::jsonb) as v",
        [
          JSON.stringify([
            ...rest.map(({ id, staging_path }) => ({ media_id: id, staging_path })),
            { media_id: first.id, staging_path: "staging/changed.jpg" },
          ]),
        ],
      );
      return {
        stored: returned.filter((item) => item.stored).length,
        withKey: await scalar<number>(
          db,
          "select count(*)::int as v from public.property_media where id = any($1::uuid[]) and media_key is not null",
          [rows.map((row) => row.id)],
        ),
        cleared,
        first: await mediaRow(db, first.id),
        last: await mediaRow(db, rows[39]?.id ?? ""),
      };
    });
    expect(result.stored).toBe(40);
    expect(result.withKey).toBe(40);
    expect(result.cleared).toBe(39);
    expect(result.first).toMatchObject({
      staging_path: expect.stringContaining("staging/") as unknown,
    });
    expect(result.first["render_job_id"]).not.toBeNull();
    expect(result.last).toMatchObject({ staging_path: null, render_job_id: null });
  });
});

describe("set_target_image and set_og_static", () => {
  const image = "o/test-b9/0-aaaaaaaa.webp";

  it("writes the image and its sizes of a region and refuses an invalid target or an unknown slug", async () => {
    const result = await withRollback(async (db) => {
      await property(db, "test-b9-target");
      await db.query(
        "insert into public.regions (slug, market_slug, name, intro) values ('test-b9-region', 'california', 'Test', 'x')",
      );
      await db.query("select public.set_target_image('region', 'test-b9-region', $1, $2::jsonb)", [
        image,
        VARIANTS,
      ]);
      return {
        row: (
          await db.query<Record<string, unknown>>(
            "select image, image_variants from public.regions where slug = 'test-b9-region'",
          )
        ).rows[0],
        invalid: await refusal(
          db,
          "select public.set_target_image('invalid', 'test-b9-region', $1, '{}')",
          [image],
        ),
        unknown: await refusal(
          db,
          "select public.set_target_image('region', 'test-b9-nowhere', $1, '{}')",
          [image],
        ),
      };
    });
    expect(result.row).toEqual({ image, image_variants: SIZES });
    expect(result.invalid).toMatchObject({ code: "22023", message: "invalid_target" });
    expect(result.unknown).toMatchObject({ code: "P0002", message: "not_found" });
  });

  it("set_og_static called twice leaves one row with the second value", async () => {
    const result = await withRollback(async (db) => {
      await db.query(
        `select public.set_og_static('{"home":{"media_key":"og/static/home.aaaaaaaa.png","w":1200,"h":630}}'::jsonb)`,
      );
      await db.query(
        `select public.set_og_static('{"home":{"media_key":"og/static/home.bbbbbbbb.png","w":1200,"h":630}}'::jsonb)`,
      );
      return (
        await db.query<{ value: unknown }>(
          "select value from public.settings where key = 'og_static'",
        )
      ).rows;
    });
    expect(result).toEqual([
      { value: { home: { media_key: "og/static/home.bbbbbbbb.png", w: 1200, h: 630 } } },
    ]);
  });
});

describe("who may call the functions", () => {
  const nil = "'00000000-0000-0000-0000-000000000000'";
  const calls = [
    `select public.upsert_asset_stub(${nil}, 'cover', 1, null)`,
    `select * from public.claim_media_for_render(${nil}, ${nil})`,
    `select public.set_asset_files(${nil}, '[]', 'h')`,
    `select public.set_asset_text(${nil}, null, null, '{}')`,
    "select public.apply_media_variants('[]')",
    "select public.clear_media_staging('[]')",
    "select public.set_target_image('story', 'x', 'k', '{}')",
    "select public.set_og_static('{}')",
    `select public.approve_asset(${nil}, ${nil}, 'human', null)`,
    `select public.reject_asset(${nil}, 'n', ${nil}, 'human', null)`,
    `select public.rerender_asset(${nil}, ${nil}, 'human', null)`,
    `select public.set_asset_caption(${nil}, ${nil}, 'human', '{}', null, null)`,
  ];

  it.each(calls)("authenticated is refused: %s", async (sql) => {
    const refused = await withRollback(async (db) => {
      const user = await human(db);
      await asRole(db, "authenticated", user);
      return refusal(db, sql);
    });
    expect(refused).toMatchObject({ code: "42501" });
  });
});
