// Invariants 5 and 21 and the publish gate (B2 migration 8): enforce_editorial_gate on submissions,
// enforce_editorial_state_order and enforce_publish_gate on properties, each against src/domain/workflow.ts.
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  canTransition,
  propertyEditorialTransitions,
  submissionTransitions,
  type WorkflowState,
} from "../../src/domain/workflow";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable. */
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

const WRONG_STATE = "P0001 wrong_state";

// A fixture inserts a request directly in any state: the gate runs on update only.
const SUBMISSION = `insert into public.submissions (
    address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story, significance,
    package, source_path, rights_version, rights_confirmed_at, rights_ip_hash, workflow_state, accepted_at
  ) values (
    '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person', 'person@example.test', 'x',
    'x', 'The Feature', '/submit', 'test-v1', now(), 'test-hash', $1, case when $2::boolean then now() end
  ) returning id`;

async function submission(db: Db, state: WorkflowState, accepted = true): Promise<string> {
  const inserted = await db.query<{ id: string }>(SUBMISSION, [state, accepted]);
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the submission insert returned no id");
  return id;
}

async function payment(db: Db, submissionId: string, status: string): Promise<void> {
  await db.query(
    "insert into public.payments (submission_id, product, amount, status) values ($1, 'The Feature', 1000, $2)",
    [submissionId, status],
  );
}

const MOVE = "update public.submissions set workflow_state = $2 where id = $1";

describe("submission gate", () => {
  it("Accepted sets accepted_at", async () => {
    const acceptedAt = await withRollback(async (db) => {
      const id = await submission(db, "Under Review", false);
      const moved = await db.query<{ accepted_at: Date | null }>(
        "update public.submissions set workflow_state = 'Accepted' where id = $1 returning accepted_at",
        [id],
      );
      return moved.rows[0]?.accepted_at;
    });
    expect(acceptedAt).toBeInstanceOf(Date);
  });

  it("Invoice Issued without acceptance raises wrong_state", async () => {
    const codes = await withRollback(async (db) => ({
      without: await attempt(db, MOVE, [await submission(db, "Accepted", false), "Invoice Issued"]),
      with: await attempt(db, MOVE, [await submission(db, "Accepted"), "Invoice Issued"]),
      reissue: await attempt(db, MOVE, [await submission(db, "Invoice Issued"), "Invoice Issued"]),
    }));
    expect(codes).toEqual({ without: WRONG_STATE, with: "ok", reissue: "ok" });
  });

  it("G60: Published to Distribution Active to Completed as the service role", async () => {
    const codes = await withRollback(async (db) => {
      const id = await submission(db, "Published");
      await asRole(db, "service_role");
      return [
        await attempt(db, MOVE, [id, "Distribution Active"]),
        await attempt(db, MOVE, [id, "Completed"]),
      ];
    });
    expect(codes).toEqual(["ok", "ok"]);
  });

  it("DL-09: Published to Completed as the service role", async () => {
    const code = await withRollback(async (db) => {
      const id = await submission(db, "Published");
      await asRole(db, "service_role");
      return attempt(db, MOVE, [id, "Completed"]);
    });
    expect(code).toBe("ok");
  });

  it("Scheduled needs a paid or waived payment", async () => {
    const codes = await withRollback(async (db) => {
      const scheduled = async (status: string | null) => {
        const id = await submission(db, "Invoice Issued");
        if (status !== null) await payment(db, id, status);
        return attempt(db, MOVE, [id, "Scheduled"]);
      };
      return {
        none: await scheduled(null),
        due: await scheduled("due"),
        paid: await scheduled("paid"),
        waived: await scheduled("waived"),
      };
    });
    expect(codes).toEqual({ none: WRONG_STATE, due: WRONG_STATE, paid: "ok", waived: "ok" });
  });

  it("DL-04: Withdrawn passes with a due payment, raises with a paid one", async () => {
    const codes = await withRollback(async (db) => {
      const withdrawn = async (from: WorkflowState, status: string | null) => {
        const id = await submission(db, from);
        if (status !== null) await payment(db, id, status);
        return attempt(db, MOVE, [id, "Withdrawn"]);
      };
      return {
        invoiceDue: await withdrawn("Invoice Issued", "due"),
        invoicePaid: await withdrawn("Invoice Issued", "paid"),
        accepted: await withdrawn("Accepted", null),
        awaitingAssets: await withdrawn("Awaiting Assets", null),
      };
    });
    expect(codes).toEqual({
      invoiceDue: "ok",
      invoicePaid: WRONG_STATE,
      accepted: "ok",
      awaitingAssets: "ok",
    });
  });

  it("an update of notes that keeps the state passes in every state", async () => {
    const states = Object.keys(submissionTransitions).filter(
      (state): state is WorkflowState => state in submissionTransitions,
    );
    const codes = await withRollback(async (db) => {
      const result: Record<string, string> = {};
      for (const state of states) {
        const id = await submission(db, state, false);
        result[state] = await attempt(
          db,
          `update public.submissions set notes = array['{"text":"x"}'::jsonb] where id = $1`,
          [id],
        );
      }
      return result;
    });
    expect(codes).toEqual(Object.fromEntries(states.map((state) => [state, "ok"])));
  });

  // The context in which no gate refuses `to`, so the comparison is of the graph itself; the gates have the cases above.
  it("every pair of the 11x11 matrix agrees with canTransition", async () => {
    const live = await withRollback(async (db) => {
      await db.query(`create function pg_temp.try_move(
          p_from public.submission_state, p_to public.submission_state, p_payment public.payment_status
        ) returns text language plpgsql as $$
        declare
          v_id uuid;
        begin
          insert into public.submissions (
            address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story,
            significance, package, source_path, rights_version, rights_confirmed_at, rights_ip_hash,
            workflow_state, accepted_at
          ) values (
            '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person',
            'person@example.test', 'x', 'x', 'The Feature', '/submit', 'test-v1', now(), 'test-hash', p_from, now()
          ) returning id into v_id;
          insert into public.payments (submission_id, product, amount, status)
          values (v_id, 'The Feature', 1000, p_payment);
          begin
            update public.submissions set workflow_state = p_to where id = v_id;
            return 'ok';
          exception when others then
            return sqlerrm;
          end;
        end
        $$`);
      const result = await db.query<{
        from: WorkflowState;
        to: WorkflowState;
        graph: boolean;
        trigger: string;
      }>(
        `select f::text as "from", t::text as "to", public.submission_transition_allowed(f, t) as graph,
           case when f = t then null
             else pg_temp.try_move(f, t, case when t = 'Withdrawn' then 'due' else 'paid' end::public.payment_status)
           end as trigger
         from unnest(enum_range(null::public.submission_state)) f
         cross join unnest(enum_range(null::public.submission_state)) t`,
      );
      return result.rows;
    });
    const expected = (from: WorkflowState, to: WorkflowState) =>
      canTransition(from, to, {
        acceptedAt: "2026-10-01T00:00:00Z",
        paymentStatus: to === "Withdrawn" ? "due" : "paid",
      });
    expect({
      pairs: live.length,
      graph: live
        .filter((p) => p.graph !== expected(p.from, p.to))
        .map((p) => `${p.from} > ${p.to}`),
      trigger: live
        .filter((p) => p.from !== p.to && (p.trigger === "ok") !== expected(p.from, p.to))
        .map((p) => `${p.from} > ${p.to}: ${p.trigger}`),
    }).toEqual({ pairs: 121, graph: [], trigger: [] });
  });
});

/** California with one region; kept when a seed already holds the market. */
async function catalog(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    "insert into public.regions (slug, market_slug, name, intro) values ('test-east-bay', 'california', 'East Bay', 'x')",
  );
}

// The twelve columns a published property fills beyond the seven of a draft (G62); hero_image comes from a photograph.
const FULL: Record<string, unknown> = {
  region_slug: "test-east-bay",
  neighborhood: "Elmwood",
  country: "United States",
  price: 2500000,
  beds: 4,
  baths: 3.5,
  interior_sq_ft: 3200,
  lot_acres: 0.4,
  year_built: 1928,
  style: "Craftsman",
  place: "A quiet street.",
};
const TWELVE = [...Object.keys(FULL), "hero_image"];

/** A draft in `review` with every publish column filled except `omit`. */
async function readyToPublish(db: Db, slug: string, omit?: string): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `insert into public.properties (slug, title, market_slug, city, state, address, type)
     values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence') returning id`,
    [slug],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the property insert returned no id");
  const fields = Object.entries(FULL).filter(([column]) => column !== omit);
  await db.query(
    `update public.properties set ${fields.map(([column], i) => `${column} = $${String(i + 2)}`).join(", ")}
     where id = $1`,
    [id, ...fields.map(([, value]) => value)],
  );
  if (omit !== "hero_image") {
    await db.query(
      "insert into public.property_media (property_id, media_key, variants) values ($1, 'test/hero.webp', $2)",
      [id, JSON.stringify({ hero: { w: 1600, h: 1067, webp: "test/hero.webp" } })],
    );
  }
  await db.query("update public.properties set editorial_state = 'review' where id = $1", [id]);
  return id;
}

const PUBLISH =
  "update public.properties set editorial_state = 'published', published_at = now() where id = $1";
const SET_STATE = `update public.properties
  set editorial_state = $2, published_at = case when $3::boolean then now() end,
    archived_at = case when $4::boolean then now() end
  where id = $1`;

describe("editorial graph", () => {
  it("every editorial pair agrees with propertyEditorialTransitions", async () => {
    const live = await withRollback(
      async (db) =>
        (
          await db.query<{ from: string; to: string; allowed: boolean }>(
            `select f::text as "from", t::text as "to", public.editorial_transition_allowed(f, t) as allowed
             from unnest(enum_range(null::public.editorial_state)) f
             cross join unnest(enum_range(null::public.editorial_state)) t`,
          )
        ).rows,
    );
    const graph: Record<string, readonly string[]> = propertyEditorialTransitions;
    const differs = live
      .filter((p) => p.allowed !== (graph[p.from] ?? []).includes(p.to))
      .map((p) => `${p.from} > ${p.to}`);
    expect({ pairs: live.length, differs }).toEqual({ pairs: 25, differs: [] });
  });

  it("draft to archived passes, published to draft and archived to published raise", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const draft = await readyToPublish(db, "test-gate-archive-draft");
      await db.query("update public.properties set editorial_state = 'draft' where id = $1", [
        draft,
      ]);
      const published = await readyToPublish(db, "test-gate-published");
      await db.query(PUBLISH, [published]);
      const archived = await readyToPublish(db, "test-gate-archived");
      await db.query(PUBLISH, [archived]);
      await db.query(SET_STATE, [archived, "archived", false, true]);
      return {
        draftToArchived: await attempt(db, SET_STATE, [draft, "archived", false, true]),
        publishedToDraft: await attempt(db, SET_STATE, [published, "draft", false, false]),
        archivedToPublished: await attempt(db, SET_STATE, [archived, "published", true, false]),
      };
    });
    expect(codes).toEqual({
      draftToArchived: "ok",
      publishedToDraft: WRONG_STATE,
      archivedToPublished: WRONG_STATE,
    });
  });

  it("an edit that keeps editorial_state passes", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await readyToPublish(db, "test-gate-keep");
      const retitle =
        "update public.properties set title = $2, editorial_state = editorial_state where id = $1";
      const inReview = await attempt(db, retitle, [id, "In review"]);
      await db.query(PUBLISH, [id]);
      return { inReview, published: await attempt(db, retitle, [id, "Published"]) };
    });
    expect(codes).toEqual({ inReview: "ok", published: "ok" });
  });
});

describe("publish gate", () => {
  // Migration 10 grants `authenticated` its rows; until then the test opens the table to the role in its transaction.
  async function publishAs(roles: string[]): Promise<string> {
    return withRollback(async (db) => {
      await catalog(db);
      const id = await readyToPublish(db, "test-gate-role");
      const user = await createStaffUser(db, roles);
      await db.query("grant select, update on public.properties to authenticated");
      await db.query(
        "create policy test_gate_open on public.properties to authenticated using (true) with check (true)",
      );
      await asRole(db, "authenticated", user);
      const code = await attempt(db, PUBLISH, [id]);
      const state = await db.query<{ editorial_state: string }>(
        "select editorial_state from public.properties where id = $1",
        [id],
      );
      return `${code} ${state.rows[0]?.editorial_state ?? "missing"}`;
    });
  }

  it("a visual_editor cannot publish", async () => {
    expect(await publishAs(["visual_editor"])).toBe("P0001 publish_not_allowed review");
  });

  it("a chief_editor publishes", async () => {
    expect(await publishAs(["chief_editor"])).toBe("ok published");
  });

  it("the service role publishes", async () => {
    const code = await withRollback(async (db) => {
      await catalog(db);
      const id = await readyToPublish(db, "test-gate-service");
      await asRole(db, "service_role");
      return attempt(db, PUBLISH, [id]);
    });
    expect(code).toBe("ok");
  });

  it("stories carry the same enforce_publish_gate function", async () => {
    const triggers = await withRollback(
      async (db) =>
        (
          await db.query<{ tbl: string; fn: string }>(
            `select tgrelid::regclass::text as tbl, tgfoid::regprocedure::text as fn from pg_trigger
             where tgname = 'enforce_publish_gate' order by 1`,
          )
        ).rows,
    );
    expect(triggers).toEqual([
      { tbl: "properties", fn: "enforce_publish_gate()" },
      { tbl: "stories", fn: "enforce_publish_gate()" },
    ]);
  });

  it("publish_incomplete: a draft with only the seven not-null columns", async () => {
    const code = await withRollback(async (db) => {
      await catalog(db);
      const inserted = await db.query<{ id: string }>(
        `insert into public.properties (slug, title, market_slug, city, state, address, type, editorial_state)
         values ('test-gate-minimal', 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence', 'review')
         returning id`,
      );
      await asRole(db, "service_role");
      return attempt(db, PUBLISH, [inserted.rows[0]?.id]);
    });
    expect(code).toBe("23514 publish_incomplete");
  });

  it.each(TWELVE)("publish_incomplete without %s", async (column) => {
    const code = await withRollback(async (db) => {
      await catalog(db);
      const id = await readyToPublish(db, "test-gate-incomplete", column);
      await asRole(db, "service_role");
      return attempt(db, PUBLISH, [id]);
    });
    expect(code).toBe("23514 publish_incomplete");
  });

  it("publish_incomplete: a complete draft publishes, emptying neighborhood raises", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await readyToPublish(db, "test-gate-complete");
      await asRole(db, "service_role");
      const published = await attempt(db, PUBLISH, [id]);
      const read = await db.query<{ version: number }>(
        "select version from public.properties where id = $1",
        [id],
      );
      const emptied = await attempt(db, "select public.save_property($1, $2, $3)", [
        id,
        read.rows[0]?.version,
        JSON.stringify({ neighborhood: null }),
      ]);
      return { published, emptied };
    });
    expect(codes).toEqual({ published: "ok", emptied: "23514 publish_incomplete" });
  });
});
