import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matrix } from "../../src/server/lib/authz";

// Invariant 18, DB-04: `write_audit` checks the roles of `action_roles`, so the newest generated file must equal the
// matrix. A matrix change without `bun run scripts/gen-action-roles.mjs` in the same commit is red here.
const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const ROW = /\('([^']+)', array\[([^\]]*)\]::public\.app_role\[\], (true|false)\)/g;

const newest = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith("_action_roles.sql"))
  .sort()
  .at(-1);

const rowsOf = (sql: string) =>
  [...sql.matchAll(ROW)]
    .map(([, action = "", roles = "", humanOnly = ""]) =>
      [action, roles.replaceAll("'", "").split(", ").sort().join(" "), humanOnly].join(" | "),
    )
    .sort();

describe("the newest action_roles migration", () => {
  it("exists", () => {
    expect(newest).toMatch(/^\d{14}_action_roles\.sql$/);
  });

  it("holds one row per matrix action with the same roles and humanOnly flag", () => {
    const sql = readFileSync(`${MIGRATIONS}${newest ?? ""}`, "utf8");
    const expected = matrix
      .map((entry) =>
        [entry.action, [...entry.roles].sort().join(" "), String(entry.humanOnly === true)].join(
          " | ",
        ),
      )
      .sort();
    expect(rowsOf(sql)).toEqual(expected);
  });
});
