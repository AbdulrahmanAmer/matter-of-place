import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { slugPattern } from "../../src/domain/contracts";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";

async function failureOf(run: Promise<unknown>): Promise<{ message: string; where: string }> {
  try {
    await run;
  } catch (error) {
    if (error instanceof pg.DatabaseError) {
      return { message: error.message, where: error.where ?? "" };
    }
    throw error;
  }
  throw new Error("the statement succeeded");
}

// Invariant 3: append-only and kept forever, for the service role too (RLS would not bind it).
describe("audit_log", () => {
  const statements = {
    update: "update public.audit_log set note = 'x' where id = $1",
    delete: "delete from public.audit_log where id = $1",
  };
  it.each([
    { op: "update", as: "service_role" },
    { op: "delete", as: "service_role" },
    { op: "update", as: "postgres" },
    { op: "delete", as: "postgres" },
  ] as const)("audit_log refuses $op as $as", async ({ op, as }) => {
    const failure = await withRollback(async (db: Db) => {
      const inserted = await db.query<{ id: string }>(
        "insert into public.audit_log (action, entity) values ('test.probe', 'probe') returning id",
      );
      if (as === "service_role") await asRole(db, "service_role");
      return failureOf(db.query(statements[op], [inserted.rows[0]?.id]));
    });
    expect({
      message: failure.message,
      fromTrigger: failure.where.includes("audit_log_immutable"),
    }).toEqual({
      message: "append_only",
      fromTrigger: true,
    });
  });
});

describe("updated_at", () => {
  it("set_updated_at stamps the transaction's now() over any value written", async () => {
    const { stamped, now } = await withRollback(async (db: Db) => {
      const id = await createStaffUser(db, ["admin"]);
      const result = await db.query<{ updated_at: Date }>(
        "update public.user_roles set display_name = 'x', updated_at = '2000-01-01' where user_id = $1 returning updated_at",
        [id],
      );
      return { stamped: result.rows[0]?.updated_at.getTime(), now: (await dbNow(db)).getTime() };
    });
    expect(stamped).toBe(now);
  });
});

/** Runs `sql` under a savepoint and returns its SQLSTATE, or `ok`; the transaction stays usable either way. */
async function outcome(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return error.code ?? "";
    throw error;
  }
}

/** California and Florida (kept when a seed already holds them) and one California region. */
async function catalog(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x'), ('florida', 'Florida', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    "insert into public.regions (slug, market_slug, name, intro) values ('test-east-bay', 'california', 'East Bay', 'x')",
  );
}

// The seven columns that stay not null (G62): a draft made from a request has only these.
const DRAFT = `insert into public.properties (slug, title, market_slug, city, state, address, type)
  values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence')`;

async function draft(db: Db, slug: string): Promise<string> {
  const inserted = await db.query<{ id: string }>(`${DRAFT} returning id`, [slug]);
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the draft insert returned no id");
  return id;
}

const variants = (w: number, h: number) =>
  JSON.stringify({ hero: { w, h, webp: "test/hero.webp" } });

describe("property_media", () => {
  it("a row is staged or stored, and a stored row has an orientation", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-media-checks");
      const insert =
        "insert into public.property_media (property_id, media_key, staging_path) values ($1, $2, $3)";
      return {
        neither: await outcome(db, insert, [id, null, null]),
        stagedWithoutAltOrOrientation: await outcome(db, insert, [id, null, `staging/${id}/a.jpg`]),
        storedWithoutOrientation: await outcome(db, insert, [id, "test/a.webp", null]),
      };
    });
    expect(codes).toEqual({
      neither: "23514",
      stagedWithoutAltOrOrientation: "ok",
      storedWithoutOrientation: "23514",
    });
  });

  it("storing a staged row sets orientation from the hero variant", async () => {
    const stored = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-media-orientation");
      const store = async (h: number) => {
        const staged = await db.query<{ id: string }>(
          "insert into public.property_media (property_id, staging_path) values ($1, 'staging/x.jpg') returning id",
          [id],
        );
        const row = await db.query<{ orientation: string }>(
          `update public.property_media set media_key = 'test/m.webp', variants = $2
           where id = $1 returning orientation`,
          [staged.rows[0]?.id, variants(1600, h)],
        );
        return row.rows[0]?.orientation;
      };
      return { h2400: await store(2400), h1067: await store(1067) };
    });
    expect(stored).toEqual({ h2400: "portrait", h1067: "landscape" });
  });
});

// G66: hero_image is the media_key of the first photograph in sequence, null while that one is staged.
describe("hero_image", () => {
  it("hero_image follows the first photograph through render, reorder and delete", async () => {
    const seen = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-hero");
      const hero = async () =>
        (
          await db.query<{ hero_image: string | null }>(
            "select hero_image from public.properties where id = $1",
            [id],
          )
        ).rows[0]?.hero_image;
      const first = await db.query<{ id: string }>(
        `insert into public.property_media (property_id, staging_path, sort_order)
         values ($1, 'staging/a.jpg', 1) returning id`,
        [id],
      );
      const staged = await hero();
      await db.query(
        "update public.property_media set media_key = 'test/a.webp', variants = $2 where id = $1",
        [first.rows[0]?.id, variants(1600, 1067)],
      );
      const rendered = await hero();
      const second = await db.query<{ id: string }>(
        `insert into public.property_media (property_id, media_key, variants, sort_order)
         values ($1, 'test/b.webp', $2, 2) returning id`,
        [id, variants(1600, 1067)],
      );
      const secondAdded = await hero();
      await db.query("update public.property_media set sort_order = 0 where id = $1", [
        second.rows[0]?.id,
      ]);
      const secondMovedFirst = await hero();
      await db.query("delete from public.property_media where id = $1", [second.rows[0]?.id]);
      const firstDeleted = await hero();
      return { staged, rendered, secondAdded, secondMovedFirst, firstDeleted };
    });
    expect(seen).toEqual({
      staged: null,
      rendered: "test/a.webp",
      secondAdded: "test/a.webp",
      secondMovedFirst: "test/b.webp",
      firstDeleted: "test/a.webp",
    });
  });
});

describe("slug_format", () => {
  it.each([
    { label: "A Slug", slug: "A Slug", valid: false },
    { label: "two--hyphens", slug: "two--hyphens", valid: false },
    { label: "121 characters", slug: "a".repeat(121), valid: false },
    { label: "berkeley-hills-house", slug: "berkeley-hills-house", valid: true },
    { label: "__e2e-assets", slug: "__e2e-assets", valid: true },
  ])("slug $label in properties and slug_history", async ({ slug, valid }) => {
    const { codes, expected } = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-slug-owner");
      // A valid slug a seed already holds meets the unique key after the format check passed.
      const taken = await db.query<{ properties: boolean; slug_history: boolean }>(
        `select exists (select 1 from public.properties where slug = $1) as properties,
          exists (select 1 from public.slug_history where slug = $1) as slug_history`,
        [slug],
      );
      const pass = (isTaken: boolean | undefined) => (isTaken === true ? "23505" : "ok");
      return {
        codes: {
          properties: await outcome(db, DRAFT, [slug]),
          slug_history: await outcome(
            db,
            "insert into public.slug_history (slug, property_id) values ($1, $2)",
            [slug, id],
          ),
        },
        expected: valid
          ? {
              properties: pass(taken.rows[0]?.properties),
              slug_history: pass(taken.rows[0]?.slug_history),
            }
          : { properties: "23514", slug_history: "23514" },
      };
    });
    expect(codes).toEqual(expected);
  });

  it("both slug checks hold slugPattern of contracts.ts", async () => {
    const defs = await withRollback(
      async (db) =>
        (
          await db.query<{ conname: string; def: string }>(
            `select conname, pg_get_constraintdef(oid) as def from pg_constraint
             where conname in ('properties_slug_format', 'slug_history_slug_format') order by conname`,
          )
        ).rows,
    );
    expect(defs.map((d) => [d.conname, d.def.includes(slugPattern)])).toEqual([
      ["properties_slug_format", true],
      ["slug_history_slug_format", true],
    ]);
  });

  it("a draft with only the seven not-null columns is stored", async () => {
    const code = await withRollback(async (db) => {
      await catalog(db);
      return outcome(db, DRAFT, ["test-minimal-draft"]);
    });
    expect(code).toBe("ok");
  });
});

// G62: a draft may have no price; a price that is set is positive.
describe("price", () => {
  it("a draft price may be null, never 0", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-price");
      const setPrice = "update public.properties set price = $2 where id = $1";
      return {
        none: await outcome(db, setPrice, [id, null]),
        zero: await outcome(db, setPrice, [id, 0]),
        one: await outcome(db, setPrice, [id, 1]),
      };
    });
    expect(codes).toEqual({ none: "ok", zero: "23514", one: "ok" });
  });
});

// Invariants 6 and 7.
describe("markets", () => {
  it("a market outside California, New York and Florida is refused", async () => {
    const code = await withRollback(async (db) =>
      outcome(
        db,
        "insert into public.markets (slug, name, country, intro) values ('texas', 'Texas', 'United States', 'x')",
      ),
    );
    expect(code).toBe("23514");
  });

  it("a Florida property in a California region is refused", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-region-match");
      const move =
        "update public.properties set market_slug = $2, region_slug = 'test-east-bay' where id = $1";
      return {
        california: await outcome(db, move, [id, "california"]),
        florida: await outcome(db, move, [id, "florida"]),
      };
    });
    expect(codes).toEqual({ california: "ok", florida: "23503" });
  });

  it("a subscriber's markets stay inside the three", async () => {
    const codes = await withRollback(async (db) => {
      const subscribe =
        "insert into public.subscribers (email, source, markets) values ($1, 'test', $2::text[])";
      const email = () => `test-${randomUUID()}@example.test`;
      return {
        outside: await outcome(db, subscribe, [email(), "{california,texas}"]),
        newYork: await outcome(db, subscribe, [email(), "{new-york}"]),
        none: await outcome(db, subscribe, [email(), "{}"]),
      };
    });
    expect(codes).toEqual({ outside: "23514", newYork: "ok", none: "ok" });
  });
});

// Invariant 22 (S55). A fixture inserts a request directly, so contact_id stays null.
const SUBMISSION = `insert into public.submissions (
    address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, brokerage,
    listed_with_agent, listing_agent_name, story, significance, package, source_path,
    rights_version, rights_confirmed_at, rights_ip_hash
  ) values (
    '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', $1, 'Test Person', 'person@example.test', $2,
    $3, $4, 'x', 'x', 'The Feature', '/submit', 'test-v1', now(), 'test-hash'
  )`;

describe("submitter", () => {
  it("an agent names a brokerage, an owner need not", async () => {
    const codes = await withRollback(async (db) => ({
      agentWithout: await outcome(db, SUBMISSION, ["agent", null, null, null]),
      agentBlank: await outcome(db, SUBMISSION, ["agent", "  ", null, null]),
      agentWith: await outcome(db, SUBMISSION, ["agent", "Test Realty", null, null]),
      ownerWithout: await outcome(db, SUBMISSION, ["owner", null, null, null]),
    }));
    expect(codes).toEqual({
      agentWithout: "23514",
      agentBlank: "23514",
      agentWith: "ok",
      ownerWithout: "ok",
    });
  });

  it("the brokerage refusal names submissions_brokerage_for_agent", async () => {
    const failure = await withRollback((db) =>
      failureOf(db.query(SUBMISSION, ["agent", null, null, null])),
    );
    expect(failure.message).toContain("submissions_brokerage_for_agent");
  });

  it("only an owner names a listing agent", async () => {
    const [agent, owner] = await withRollback(async (db) => {
      const allowed = await outcome(db, SUBMISSION, ["owner", null, true, "Other"]);
      const refused = await failureOf(
        db.query(SUBMISSION, ["agent", "Test Realty", null, "Other"]),
      );
      return [refused.message, allowed];
    });
    expect([agent.includes("submissions_listing_for_owner"), owner]).toEqual([true, "ok"]);
  });

  it("an agent cannot say whether the home is listed", async () => {
    const code = await withRollback((db) =>
      outcome(db, SUBMISSION, ["agent", "Test Realty", true, null]),
    );
    expect(code).toBe("23514");
  });

  it("a second contact whose email differs only in case is refused", async () => {
    const insert =
      "insert into public.contacts (kind, name, email) values ('agent', 'Test Person', $1)";
    const { first, second, message } = await withRollback(async (db) => {
      const email = `test-${randomUUID()}@example.test`;
      const first = await outcome(db, insert, [email]);
      const failure = await failureOf(db.query(insert, [email.toUpperCase()]));
      return { first, second: "refused", message: failure.message };
    });
    expect({ first, second, named: message.includes("contacts_email_key") }).toEqual({
      first: "ok",
      second: "refused",
      named: true,
    });
  });

  it("a contact is found by name and a request by contact", async () => {
    const indexes = await withRollback(
      async (db) =>
        (
          await db.query<{ indexname: string }>(
            `select indexname from pg_indexes
             where indexname in ('contacts_name_idx', 'submissions_contact_id_idx') order by 1`,
          )
        ).rows,
    );
    expect(indexes.map((i) => i.indexname)).toEqual([
      "contacts_name_idx",
      "submissions_contact_id_idx",
    ]);
  });

  it("a request in any currency but USD is refused", async () => {
    const codes = await withRollback(async (db) => {
      const insert = `insert into public.submissions (
          address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story,
          significance, package, source_path, currency, rights_version, rights_confirmed_at, rights_ip_hash
        ) values (
          '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person',
          'person@example.test', 'x', 'x', 'The Feature', '/submit', $1, 'test-v1', now(), 'test-hash'
        )`;
      return {
        euro: await outcome(db, insert, ["EUR"]),
        dollar: await outcome(db, insert, ["USD"]),
      };
    });
    expect(codes).toEqual({ euro: "23514", dollar: "ok" });
  });
});
