import { describe, expect, it } from "vitest";
import { checkMigrations } from "../../scripts/check-migrations.mjs";

const MAIN = ["20261001090000", "20261002100000"];
const DIR = "supabase/migrations";
const CREATE =
  "-- down: drop table notes\nset lock_timeout = '5s';\ncreate table notes (id uuid);\n";
const DROP =
  "-- irreversible: data goes\nset lock_timeout = '5s';\nalter table notes drop column body;\n";

function run(added: Record<string, string>, changed: string[] = []) {
  return checkMigrations({
    changed,
    added: Object.keys(added),
    mainPrefixes: MAIN,
    readFile: (path) => added[path] ?? "",
  });
}

describe("checkMigrations", () => {
  it("passes a clean tree and a new file after the newest on main", () => {
    expect([run({}), run({ [`${DIR}/20261002110000_notes.sql`]: CREATE })]).toEqual([[], []]);
  });

  it("refuses an edited applied migration", () => {
    expect(run({}, [`${DIR}/20261001090000_extensions_enums.sql`])).toEqual([
      `applied migration changed: ${DIR}/20261001090000_extensions_enums.sql`,
    ]);
  });

  it("refuses an added file with an older timestamp than main", () => {
    expect(run({ [`${DIR}/20261001095900_notes.sql`]: CREATE })).toEqual([
      `rename ${DIR}/20261001095900_notes.sql to a timestamp after 20261002100000`,
    ]);
  });

  it("refuses a drop column without the contract-of header", () => {
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: DROP })).toEqual([
      `destructive change without "-- contract-of: <14-digit version>" in its first 30 lines: ${DIR}/20261002110000_drop_body.sql`,
    ]);
  });

  it("accepts a drop column with the contract-of header in its first 30 lines", () => {
    const contract = `-- contract-of: 20261001090000\n${DROP}`;
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: contract })).toEqual([]);
  });

  it("refuses a contract-of header below line 30", () => {
    const late = `${DROP}${"--\n".repeat(30)}-- contract-of: 20261001090000\n`;
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: late })).toHaveLength(1);
  });
});
