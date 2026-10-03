import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXED_NOW, at, atFrom, deterministicUuid, mulberry32 } from "../fixtures/clock";

const DAY_MS = 86_400_000;
const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
// db.ts is the harness of B2, not a factory: its `createAuthUser` mints a Supabase auth id and B4 never calls it.
const HARNESS = "db.ts";
const NONDETERMINISTIC = /Date\.now|Math\.random|randomUUID/;

const take = (next: () => number, count: number) => Array.from({ length: count }, next);

describe("mulberry32", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(mulberry32(7), 20)).toEqual(take(mulberry32(7), 20));
  });

  it("gives a different sequence for another seed", () => {
    expect(take(mulberry32(7), 20)).not.toEqual(take(mulberry32(8), 20));
  });

  it("stays in [0, 1) and moves on every call", () => {
    const values = take(mulberry32(42), 1000);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBe(1000);
  });
});

describe("deterministicUuid", () => {
  it("gives the same id for the same call", () => {
    expect(deterministicUuid("properties", 1)).toBe(deterministicUuid("properties", 1));
  });

  it("matches the version 5 ids an independent implementation gives", () => {
    expect(deterministicUuid("properties", 1)).toBe("5abdc015-d8c8-54f4-8933-dca2c55755c5");
    expect(deterministicUuid("properties", 2)).toBe("9f4e5574-9e38-53da-a528-52a39ab17527");
    expect(deterministicUuid("submissions", 1)).toBe("cc68e30e-ae77-580d-9ba4-7d6980ccc9a5");
  });

  it("differs by namespace and by index", () => {
    expect(deterministicUuid("properties", 1)).not.toBe(deterministicUuid("submissions", 1));
    expect(deterministicUuid("properties", 1)).not.toBe(deterministicUuid("properties", 2));
  });

  it("is a well-formed version 5 uuid", () => {
    expect(deterministicUuid("stories", 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("the time helpers", () => {
  it("fix now at 2026-10-01T12:00:00Z", () => {
    expect(FIXED_NOW.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("at(days) offsets FIXED_NOW", () => {
    expect(at(0).getTime()).toBe(FIXED_NOW.getTime());
    expect(at(2).getTime() - FIXED_NOW.getTime()).toBe(2 * DAY_MS);
    expect(at(-15).toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });

  it("atFrom(base, days) offsets the base it is given", () => {
    const base = new Date("2031-03-09T08:30:00Z");
    expect(base.getTime() - atFrom(base, -15).getTime()).toBe(15 * DAY_MS);
    expect(atFrom(base, 0).getTime()).toBe(base.getTime());
    expect(atFrom(base, 1)).not.toBe(base);
  });
});

describe("the fixture files", () => {
  const sources = readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".ts") && name !== HARNESS)
    .map((name) => ({ name, text: readFileSync(join(FIXTURES, name), "utf8") }));

  it("read no wall clock, no Math.random and no random uuid", () => {
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources
      .filter(({ text }) => NONDETERMINISTIC.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
