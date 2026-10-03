import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { slugPattern } from "../../src/domain/contracts";
import {
  asRole,
  createAuthUser,
  createStaffUser,
  dbNow,
  withRollback,
  type Db,
} from "../fixtures/db";
import { savePropertyAllowedKeys, schemaManifest, systemPropertyColumns } from "./schema-manifest";

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

/** A draft with every column a published property needs (enforce_publish_gate), its photograph rendered. */
async function complete(db: Db, slug: string): Promise<string> {
  const id = await draft(db, slug);
  await db.query(
    `update public.properties set region_slug = 'test-east-bay', neighborhood = 'Elmwood', country = 'United States',
       price = 2500000, beds = 4, baths = 3.5, interior_sq_ft = 3200, lot_acres = 0.4, year_built = 1928,
       style = 'Craftsman', place = 'A quiet street.'
     where id = $1`,
    [id],
  );
  await db.query(
    "insert into public.property_media (property_id, media_key, variants) values ($1, 'test/hero.webp', $2)",
    [id, variants(1600, 1067)],
  );
  return id;
}

/** `complete`, moved through review to published. */
async function published(db: Db, slug: string): Promise<string> {
  const id = await complete(db, slug);
  await db.query("update public.properties set editorial_state = 'review' where id = $1", [id]);
  await db.query(
    "update public.properties set editorial_state = 'published', published_at = now() where id = $1",
    [id],
  );
  return id;
}

async function versionOf(db: Db, id: string): Promise<number> {
  const read = await db.query<{ version: number }>(
    "select version from public.properties where id = $1",
    [id],
  );
  const version = read.rows[0]?.version;
  if (version === undefined) throw new Error("no property row");
  return version;
}

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

  it("a staged photograph put first on a published property raises publish_incomplete", async () => {
    const failure = await withRollback(async (db) => {
      await catalog(db);
      const id = await published(db, "test-hero-published");
      return failureOf(
        db.query(
          "insert into public.property_media (property_id, staging_path, sort_order) values ($1, 'staging/b.jpg', -1)",
          [id],
        ),
      );
    });
    expect({
      message: failure.message,
      fromGate: failure.where.includes("enforce_publish_gate"),
    }).toEqual({ message: "publish_incomplete", fromGate: true });
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

const SAVE = "select version from public.save_property($1, $2, $3)";

/** One `save_property` call under a savepoint: `ok` or `<SQLSTATE> <message>`. */
async function saved(db: Db, id: string, version: number, patch: object): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(SAVE, [id, version, JSON.stringify(patch)]);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

// Invariant 10 (GD-01): the one edit path of the Worker's server functions.
describe("save_property", () => {
  it("a save with a stale version raises version_conflict", async () => {
    const result = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-save-conflict");
      await asRole(db, "service_role");
      const first = await db.query<{ version: number }>(SAVE, [
        id,
        1,
        JSON.stringify({ title: "New" }),
      ]);
      return { version: first.rows[0]?.version, again: await saved(db, id, 1, { title: "Newer" }) };
    });
    expect(result).toEqual({ version: 2, again: "40001 version_conflict" });
  });

  it("refuses every column outside savePropertyAllowedKeys", async () => {
    const refused = Object.keys(schemaManifest["properties"] ?? {}).filter(
      (column) => !savePropertyAllowedKeys.includes(column),
    );
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-save-refused");
      await asRole(db, "service_role");
      const result: Record<string, string> = {};
      for (const column of refused) result[column] = await saved(db, id, 1, { [column]: null });
      return result;
    });
    const named = [
      "version",
      "editorial_state",
      "video",
      "og_image_key",
      "hero_image",
      "unpublish_reason",
    ];
    expect(named.filter((column) => !refused.includes(column))).toEqual([]);
    expect(codes).toEqual(
      Object.fromEntries(refused.map((column) => [column, "22023 invalid_patch_key"])),
    );
  });

  it("on a draft a patch of each allowed key with a valid value passes", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-save-allowed");
      const editor = await createAuthUser(db);
      const valid: Record<string, unknown> = {
        slug: "test-save-allowed-renamed",
        title: "Renamed",
        market_slug: "california",
        region_slug: "test-east-bay",
        city: "Oakland",
        neighborhood: "Rockridge",
        state: "CA",
        country: "United States",
        address: "2 Test Way",
        coordinates: "(37.84,-122.25)",
        price: 1800000,
        currency: "USD",
        beds: 3,
        baths: 2.5,
        interior_sq_ft: 2100,
        lot_acres: 0.2,
        year_built: 1931,
        type: "Estate",
        style: "Tudor",
        architect: "Test Architect",
        designer: "Test Designer",
        status: "Active",
        story: ["One.", "Two."],
        place: "Near the hills.",
        representative_id: null,
        presented_by_owner: true,
        listing_url: "https://example.test/listing",
        hero_rank: 9001,
        featured_rank: 9001,
        updated_by: editor,
      };
      await asRole(db, "service_role");
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(valid)) {
        result[key] = await saved(db, id, await versionOf(db, id), { [key]: value });
      }
      return result;
    });
    expect(codes).toEqual(Object.fromEntries(savePropertyAllowedKeys.map((key) => [key, "ok"])));
  });

  it("an empty patch raises the version by one and still checks it", async () => {
    const result = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-save-empty");
      await asRole(db, "service_role");
      const current = await saved(db, id, 1, {});
      return { current, version: await versionOf(db, id), stale: await saved(db, id, 1, {}) };
    });
    expect(result).toEqual({ current: "ok", version: 2, stale: "40001 version_conflict" });
  });
});

// Invariant 11 (GD-02).
describe("slug", () => {
  const RENAME = "update public.properties set slug = $2 where id = $1";

  it("renaming a draft writes the old slug to slug_history", async () => {
    const history = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-slug-old");
      await db.query(RENAME, [id, "test-slug-new"]);
      return (
        await db.query<{ slug: string }>(
          "select slug from public.slug_history where property_id = $1",
          [id],
        )
      ).rows;
    });
    expect(history).toEqual([{ slug: "test-slug-old" }]);
  });

  it("renaming a published property raises slug_immutable", async () => {
    const failure = await withRollback(async (db) => {
      await catalog(db);
      const id = await published(db, "test-slug-published");
      return failureOf(db.query(RENAME, [id, "test-slug-moved"]));
    });
    expect(failure.message).toBe("slug_immutable");
  });

  it("publish, archive, return to draft, rename raises slug_immutable", async () => {
    const failure = await withRollback(async (db) => {
      await catalog(db);
      const id = await published(db, "test-slug-returned");
      await db.query(
        `update public.properties set editorial_state = 'archived', published_at = null, archived_at = now()
         where id = $1`,
        [id],
      );
      await db.query(
        "update public.properties set editorial_state = 'draft', archived_at = null where id = $1",
        [id],
      );
      return failureOf(db.query(RENAME, [id, "test-slug-moved"]));
    });
    expect(failure.message).toBe("slug_immutable");
  });

  it("a new property cannot take a slug_history slug: slug_taken", async () => {
    const failure = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-slug-kept");
      await db.query(RENAME, [id, "test-slug-current"]);
      return failureOf(db.query(DRAFT, ["test-slug-kept"]));
    });
    expect(failure.message).toBe("slug_taken");
  });
});

// Invariant 6.
describe("published_at", () => {
  it("editorial_state published with published_at null raises", async () => {
    const failure = await withRollback(async (db) => {
      await catalog(db);
      const id = await complete(db, "test-published-at");
      await db.query("update public.properties set editorial_state = 'review' where id = $1", [id]);
      return failureOf(
        db.query("update public.properties set editorial_state = 'published' where id = $1", [id]),
      );
    });
    expect(failure.message).toContain("properties_published_pairing");
  });
});

describe("ranks", () => {
  it.each(["hero_rank", "featured_rank"])(
    "a second non-null %s raises, two nulls pass",
    async (column) => {
      const codes = await withRollback(async (db) => {
        await catalog(db);
        const a = await draft(db, "test-rank-a");
        const b = await draft(db, "test-rank-b");
        const c = await draft(db, "test-rank-c");
        const d = await draft(db, "test-rank-d");
        const rank = `update public.properties set ${column} = $2 where id = $1`;
        return {
          first: await outcome(db, rank, [a, 9001]),
          second: await outcome(db, rank, [b, 9001]),
          nullC: await outcome(db, rank, [c, null]),
          nullD: await outcome(db, rank, [d, null]),
        };
      });
      expect(codes).toEqual({ first: "ok", second: "23505", nullC: "ok", nullD: "ok" });
    },
  );
});

/** One row of `table`, inserted as postgres; returns its id. */
async function rowOf(db: Db, table: string): Promise<string> {
  const one = async (sql: string, params: unknown[] = []) => {
    const id = (await db.query<{ id: string }>(`${sql} returning id`, params)).rows[0]?.id;
    if (id === undefined) throw new Error(`no ${table} row`);
    return id;
  };
  const email = () => `test-${randomUUID()}@example.test`;
  const submission = () => one(SUBMISSION, ["owner", null, null, null]);
  const payment = async () =>
    one(
      "insert into public.payments (submission_id, product, amount) values ($1, 'The Feature', 1000)",
      [await submission()],
    );
  switch (table) {
    case "properties":
      return draft(db, "test-delete-property");
    case "stories":
      return one(
        `insert into public.stories (slug, title, deck, category, market_slug)
         values ('test-delete-story', 'Test story', 'x', 'Places', 'california')`,
      );
    case "subscribers":
      return one("insert into public.subscribers (email, source) values ($1, 'test')", [email()]);
    case "submissions":
      return submission();
    case "contacts":
      return one(
        "insert into public.contacts (kind, name, email) values ('owner', 'Test Person', $1)",
        [email()],
      );
    case "inquiries":
      return one(
        `insert into public.inquiries (intent, name, email, message, source_path)
         values ('ask', 'Test Person', 'person@example.test', 'x', '/contact')`,
      );
    case "payments":
      return payment();
    case "campaigns":
      return one(
        "insert into public.campaigns (property_id, payment_id, package) values ($1, $2, 'The Feature')",
        [await draft(db, "test-delete-campaign"), await payment()],
      );
    default:
      throw new Error(`no fixture for ${table}`);
  }
}

// Invariant 4 (GD-04): it binds the service role, which RLS does not.
describe("hard_delete", () => {
  it.each([
    "properties",
    "stories",
    "subscribers",
    "submissions",
    "contacts",
    "inquiries",
    "payments",
    "campaigns",
  ])("%s: refused as the service role until mop.retention is on", async (table) => {
    const result = await withRollback(async (db) => {
      await catalog(db);
      const id = await rowOf(db, table);
      await asRole(db, "service_role");
      const remove = `delete from public.${table} where id = $1`;
      await db.query("savepoint refused");
      const refused = await failureOf(db.query(remove, [id]));
      await db.query("rollback to savepoint refused");
      await db.query("select set_config('mop.retention', 'on', true)");
      const deleted = await db.query(remove, [id]);
      return { refused: refused.message, deleted: deleted.rowCount };
    });
    expect(result).toEqual({ refused: "hard_delete_refused", deleted: 1 });
  });
});

// DB-16: a system column written while an editor types never causes a false 409.
describe("system_columns", () => {
  it("a hero render between read and save does not conflict", async () => {
    const result = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-system-hero");
      const staged = await db.query<{ id: string }>(
        "insert into public.property_media (property_id, staging_path) values ($1, 'staging/a.jpg') returning id",
        [id],
      );
      const read = await versionOf(db, id);
      await db.query(
        "update public.property_media set media_key = 'test/a.webp', variants = $2 where id = $1",
        [staged.rows[0]?.id, variants(1600, 1067)],
      );
      const hero = await db.query<{ hero_image: string | null }>(
        "select hero_image from public.properties where id = $1",
        [id],
      );
      await asRole(db, "service_role");
      return { hero: hero.rows[0]?.hero_image, save: await saved(db, id, read, { title: "x" }) };
    });
    expect(result).toEqual({ hero: "test/a.webp", save: "ok" });
  });

  it("video and og_image_key keep the version, title raises it", async () => {
    const versions = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-system-version");
      const before = await versionOf(db, id);
      await db.query(
        `update public.properties set video = '{"src":"test/reel.mp4"}' where id = $1`,
        [id],
      );
      const video = await versionOf(db, id);
      await db.query("update public.properties set og_image_key = 'test/og.jpg' where id = $1", [
        id,
      ]);
      const og = await versionOf(db, id);
      await db.query("update public.properties set title = 'Retitled' where id = $1", [id]);
      return { before, video, og, title: await versionOf(db, id) };
    });
    expect(versions).toEqual({ before: 1, video: 1, og: 1, title: 2 });
  });

  it("properties_version_bump ignores systemPropertyColumns and three more", async () => {
    const source = await withRollback(
      async (db) =>
        (
          await db.query<{ prosrc: string }>(
            "select prosrc from pg_proc where proname = 'properties_version_bump'",
          )
        ).rows[0]?.prosrc ?? "",
    );
    const literal = /array\[([^\]]*)\]/.exec(source)?.[1] ?? "";
    const named = [...literal.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(named.sort()).toEqual(
      [...systemPropertyColumns, "updated_at", "version", "search_text"].sort(),
    );
  });
});

// DL-02: one property per request, one campaign per payment.
describe("unique_links", () => {
  it("a second property for one submission raises 23505, two without one pass", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const submission = await rowOf(db, "submissions");
      const a = await draft(db, "test-link-a");
      const b = await draft(db, "test-link-b");
      const c = await draft(db, "test-link-c");
      const d = await draft(db, "test-link-d");
      const link = "update public.properties set submission_id = $2 where id = $1";
      return {
        first: await outcome(db, link, [a, submission]),
        second: await outcome(db, link, [b, submission]),
        nullC: await outcome(db, link, [c, null]),
        nullD: await outcome(db, link, [d, null]),
      };
    });
    expect(codes).toEqual({ first: "ok", second: "23505", nullC: "ok", nullD: "ok" });
  });

  it("a second campaign for one payment raises 23505", async () => {
    const codes = await withRollback(async (db) => {
      await catalog(db);
      const payment = await rowOf(db, "payments");
      const property = await draft(db, "test-link-campaign");
      const campaign =
        "insert into public.campaigns (property_id, payment_id, package) values ($1, $2, 'The Feature')";
      return {
        first: await outcome(db, campaign, [property, payment]),
        second: await outcome(db, campaign, [property, payment]),
      };
    });
    expect(codes).toEqual({ first: "ok", second: "23505" });
  });
});
