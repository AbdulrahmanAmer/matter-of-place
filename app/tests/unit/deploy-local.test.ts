import { describe, expect, it } from "vitest";
import { pendingMigrations } from "../../scripts/deploy-local.mjs";

// Ruling H103: the laptop deploy rehearses, inside a rolled-back transaction, only the migrations the database lacks.

describe("pendingMigrations", () => {
  it("names the migrations the database has not recorded, oldest first, and nothing else in the folder", () => {
    const files = [
      "20261013093000_colleague_jobs.sql",
      "README.md",
      "20261013074829_matter_live.sql",
      "20261012120000_done.sql",
    ];
    expect(pendingMigrations(files, ["20261012120000", ""])).toEqual([
      "20261013074829_matter_live.sql",
      "20261013093000_colleague_jobs.sql",
    ]);
  });

  it("names none when every migration is recorded", () => {
    expect(pendingMigrations(["20261012120000_done.sql"], ["20261012120000"])).toEqual([]);
  });
});
