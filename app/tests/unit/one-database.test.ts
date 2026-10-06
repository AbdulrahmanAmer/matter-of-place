// One database (G-901, P-331, READ FIRST line of GOTCHAS.md). On the operator's laptop `SUPABASE_URL` and
// `SUPABASE_SERVICE_ROLE_KEY` are Windows user-level variables of another business's Supabase project, and on
// 2026-10-06 a test helper that read them created two accounts there. This test fails the moment a file under
// tests/ or scripts/ reads either name without the explicit CI switch (`E2E_STACK` for code run by Playwright and
// vitest, `--stack` for a script, or the shared helper `scripts/lib/one-database.mjs`), or when the dev profile loader stops overwriting the two names.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = resolve(import.meta.dirname, "../..");
const GENERIC = /SUPABASE_(?:URL|SERVICE_ROLE_KEY)/;
// A read: process.env["NAME"] not followed by an assignment, or required("NAME") / requiredEnv("NAME").
const READ =
  /process\.env\["SUPABASE_(?:URL|SERVICE_ROLE_KEY)"\](?!\s*=[^=])|required(?:Env)?\(\s*"SUPABASE_(?:URL|SERVICE_ROLE_KEY)"/;
// The switch itself, or the shared helper that holds it (scripts/lib/one-database.mjs).
const SWITCH = /E2E_STACK|--stack|one-database.mjs/;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(?:ts|tsx|mjs|js)$/.test(name) && !name.includes("node_modules"))
    .map((name) => join(dir, name));
}

describe("one database: no client is built from the shell's SUPABASE_URL (G-901)", () => {
  const files = [...sources(join(APP, "tests")), ...sources(join(APP, "scripts"))];

  it("every read of SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY under tests/ or scripts/ sits behind the CI switch", () => {
    const offenders = files
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return GENERIC.test(text) && READ.test(text) && !SWITCH.test(text);
      })
      .map((file) => relative(APP, file).replaceAll("\\", "/"));
    expect(
      offenders,
      "files that read the generic names with no E2E_STACK or --stack switch",
    ).toEqual([]);
  });

  it("the dev profile loader overwrites the two generic names with mop-dev's values", () => {
    const loader = readFileSync(join(APP, "scripts/load-env.mjs"), "utf8");
    expect(loader).toMatch(/export SUPABASE_URL=/);
    expect(loader).toMatch(/export SUPABASE_SERVICE_ROLE_KEY=/);
  });

  it("ci.yml sets the switch at the workflow level, so CI's own stack is the only place the generic names are read", () => {
    const ci = readFileSync(join(APP, "../.github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/^env:\n(?:.*\n)*?\s+E2E_STACK: "1"/m);
  });
});
