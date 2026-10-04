// The feature flags (GQ-05, G18): `settings.flags` plus `coming_soon_global` read as one snake_case record. The
// assertions use toMatchObject so a later slice can add a key (`csp_enforce`, `maintenance`) without editing them.
import { describe, expect, it } from "vitest";
import { defaultFlags, featureFlags, flagsSchema } from "../../src/domain/flags";
import { mergeFlags } from "../../src/server/lib/flags";

describe("flagsSchema and defaultFlags", () => {
  it("defaults every feature flag to false", () => {
    expect(featureFlags).toEqual(expect.arrayContaining(["new_channels", "archive_pages"]));
    expect(defaultFlags).toMatchObject({ new_channels: false, archive_pages: false });
    expect(Object.values(defaultFlags).every((value) => !value)).toBe(true);
  });

  it("keeps a stored key and drops an unknown one", () => {
    expect(flagsSchema.parse({ new_channels: true, nonsense: true })).toEqual({
      new_channels: true,
    });
  });

  it("refuses a row that is not a record of booleans", () => {
    expect(flagsSchema.safeParse({ new_channels: "yes" }).success).toBe(false);
    expect(flagsSchema.safeParse(null).success).toBe(false);
    expect(flagsSchema.safeParse("true").success).toBe(false);
  });
});

describe("mergeFlags", () => {
  it("turns coming_soon_global into the flag coming_soon", () => {
    expect(mergeFlags({}, true)).toMatchObject({ coming_soon: true });
    expect(mergeFlags({}, false)).toMatchObject({ coming_soon: false });
    expect(mergeFlags({}, null)).toMatchObject({ coming_soon: false });
  });

  it("returns coming_soon, new_channels and archive_pages in snake_case", () => {
    const merged = mergeFlags({ new_channels: true }, true);
    expect(merged).toMatchObject({ coming_soon: true, new_channels: true, archive_pages: false });
    expect(Object.keys(merged).filter((key) => !/^[a-z]+(_[a-z]+)*$/.test(key))).toEqual([]);
  });

  it("reads archive_pages as false when the row lacks it and as stored when it has it", () => {
    expect(mergeFlags({ new_channels: true }, false)).toMatchObject({ archive_pages: false });
    expect(mergeFlags({ archive_pages: true }, false)).toMatchObject({ archive_pages: true });
  });

  it("ignores an unknown key of the row", () => {
    expect(Object.keys(mergeFlags({ nonsense: true }, false))).not.toContain("nonsense");
  });

  it("gives the defaults for a malformed row and still reads the coming-soon switch", () => {
    for (const row of [null, undefined, "true", 7, { new_channels: "yes" }]) {
      expect(mergeFlags(row, true)).toMatchObject({
        coming_soon: true,
        new_channels: false,
        archive_pages: false,
      });
    }
  });
});
