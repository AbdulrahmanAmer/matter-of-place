import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { errorCodes } from "../../src/server/lib/error-codes";

// API-03: a message a migration raises is the code the API answers with, so it must be a key of `errorCodes`.
const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const RAISED = /raise\s+exception\s+'([^'\s:]+)|message\s*=\s*'([^'\s:]+)/gi;

const raised = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .flatMap((name) =>
    [...readFileSync(join(MIGRATIONS, name), "utf8").matchAll(RAISED)].flatMap((match) => {
      const message = match[1] ?? match[2];
      return message === undefined ? [] : [{ name, message }];
    }),
  );

describe("errorCodes", () => {
  it("reads at least one raised message from the migrations", () => {
    expect(raised.length).toBeGreaterThan(0);
  });

  it("holds every message a migration raises", () => {
    const unknown = raised.filter(({ message }) => !(message in errorCodes));
    expect(unknown).toEqual([]);
  });

  it("gives every code a status in the 4xx or 5xx range", () => {
    expect(Object.values(errorCodes).filter((status) => status < 400 || status > 599)).toEqual([]);
  });
});
