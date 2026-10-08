// B16 steps 2 and 5: `settings_put_site` is the one write of `settings.site`. It audits in the same transaction, B2's trigger
// moves catalog_version, only the service role may call it, and the stored row parses with the domain schema.
import { describe, expect, it } from "vitest";
import { retentionPeriods } from "../../src/domain/retention";
import { siteSettingsSchema } from "../../src/domain/settings";
import { asRole, withRollback, type Db } from "../fixtures/db";

const VALUE = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};
const PUT = "select public.settings_put_site($1::jsonb, null, 'human', $2, $3)";

async function catalogVersion(db: Db): Promise<number> {
  const read = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  const version = read.rows[0]?.version;
  if (version === undefined) throw new Error("no catalog_version row");
  return Number(version);
}

describe("settings_put_site", () => {
  it("writes the value and one audit_log row with its action, entity, actor kind and note", async () => {
    const outcome = await withRollback(async (db) => {
      const before = await db.query<{ value: unknown }>(
        "select value from public.settings where key = 'site'",
      );
      await asRole(db, "service_role");
      await db.query(PUT, [JSON.stringify(VALUE), "req-site-put", "test: settings-site"]);
      await db.query("reset role");
      const audit = await db.query(
        `select action, entity, entity_id, actor_id, actor_kind::text, note, before, after
         from public.audit_log where request_id = 'req-site-put'`,
      );
      const stored = await db.query<{ value: unknown }>(
        "select value from public.settings where key = 'site'",
      );
      return { audit: audit.rows, before: before.rows[0]?.value, stored: stored.rows[0]?.value };
    });
    expect(outcome.audit).toEqual([
      {
        action: "settings.site_put",
        entity: "settings.site",
        entity_id: null,
        actor_id: null,
        actor_kind: "human",
        note: "test: settings-site",
        before: outcome.before,
        after: VALUE,
      },
    ]);
    expect(outcome.stored).toEqual(VALUE);
  });

  it("moves catalog_version by 1 through B2's trigger", async () => {
    const bumps = await withRollback(async (db) => {
      const before = await catalogVersion(db);
      await db.query(PUT, [JSON.stringify(VALUE), "req-site-bump", "test: settings-site"]);
      return (await catalogVersion(db)) - before;
    });
    expect(bumps).toBe(1);
  });

  it.each(["anon", "authenticated"] as const)("refuses the %s role", async (role) => {
    const refused = await withRollback(async (db) => {
      await asRole(db, role);
      return db.query(PUT, [JSON.stringify(VALUE), "req-site-role", "test"]).then(
        () => "allowed",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    });
    expect(refused).toBe("permission denied for function settings_put_site");
  });
});

describe("settings.site", () => {
  it("the stored row parses with siteSettingsSchema", async () => {
    const value = await withRollback(
      async (db) =>
        (await db.query<{ value: unknown }>("select value from public.settings where key = 'site'"))
          .rows[0]?.value,
    );
    expect(siteSettingsSchema.safeParse(value).success).toBe(true);
  });
});

describe("retention", () => {
  it("retention_policies holds every period of retentionPeriods, key by key", async () => {
    const rows = await withRollback(async (db) => {
      const read = await db.query<{ key: string; months: number; days: number; hours: number }>(
        `select key,
                (extract(year from keep_for) * 12 + extract(month from keep_for))::int as months,
                extract(day from keep_for)::int as days,
                extract(hour from keep_for)::int as hours
           from public.retention_policies where key = any($1::text[])`,
        [Object.keys(retentionPeriods)],
      );
      return new Map(read.rows.map((row) => [row.key, row]));
    });
    for (const [key, period] of Object.entries(retentionPeriods)) {
      const row = rows.get(key);
      const stored = row && { months: row.months, days: row.days, hours: row.hours };
      expect([key, stored]).toEqual([key, { months: 0, days: 0, hours: 0, ...period }]);
    }
  });
});
