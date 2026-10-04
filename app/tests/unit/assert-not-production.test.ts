import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertNotProduction,
  isProductionEnvironment,
} from "../../scripts/lib/assert-not-production.mjs";

const APP = new URL("../../", import.meta.url);
const DB_URL = "postgresql://postgres.ref:secret@127.0.0.1:5432/postgres";
const IMPORTS_GUARD = /from\s+["'][^"']*\/assert-not-production\.mjs["']/;

// Every destructive or test command (B2 invariant 23). Steps 3 and 12 and later slices append the files they create.
const guardedScripts = [
  "scripts/db-reset-dev.mjs",
  "tests/fixtures/db.ts",
  "tests/db/global-setup.ts",
  "scripts/e2e-coming-soon.ts",
  "scripts/seed.ts",
  "scripts/job-selftest.ts",
  "scripts/set-environment.ts",
  "scripts/with-coming-soon.ts",
];

const missingTable = Object.assign(new Error('relation "public.settings" does not exist'), {
  code: "42P01",
});

describe("assertNotProduction", () => {
  it("throws when settings.environment is production", async () => {
    await expect(
      assertNotProduction({ dbUrl: DB_URL, readEnvironment: () => Promise.resolve("production") }),
    ).rejects.toThrow("refusing: production database");
  });

  it.each([
    { name: "development", read: () => Promise.resolve("development") },
    { name: "preview", read: () => Promise.resolve("preview") },
    { name: "no environment row", read: () => Promise.resolve(null) },
    { name: "no settings table", read: () => Promise.reject(missingTable) },
  ])("resolves on $name", async ({ read }) => {
    await expect(
      assertNotProduction({ dbUrl: DB_URL, readEnvironment: read }),
    ).resolves.toBeUndefined();
  });

  it("rethrows any other database error", async () => {
    const refused = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    await expect(
      assertNotProduction({ dbUrl: DB_URL, readEnvironment: () => Promise.reject(refused) }),
    ).rejects.toThrow("password authentication failed");
  });

  it("refuses without a database URL", async () => {
    await expect(
      assertNotProduction({ dbUrl: "", readEnvironment: () => Promise.resolve("development") }),
    ).rejects.toThrow("refusing: DEV_DB_URL is not set");
  });
});

describe("isProductionEnvironment", () => {
  it("is true only for exactly production", () => {
    expect(
      ["production", "Production", "production ", "development", "preview", null].map(
        isProductionEnvironment,
      ),
    ).toEqual([true, false, false, false, false, false]);
  });
});

describe("guardedScripts", () => {
  it("every listed file exists, imports the guard and calls assertNotProduction(", () => {
    const offenders = guardedScripts.filter((path) => {
      const file = new URL(path, APP);
      if (!existsSync(file)) return true;
      const text = readFileSync(file, "utf8");
      return !IMPORTS_GUARD.test(text) || !text.includes("assertNotProduction(");
    });
    expect(offenders).toEqual([]);
  });
});
