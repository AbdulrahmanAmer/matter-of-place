// The list of event names is one constant (`analyticsEvents`): the type, the typed `track()` calls and the API's
// allow-list all read it, so a name the site sends and the list lacks is a name the API would drop.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyticsEvents } from "../../src/lib/analytics";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Every event name written as a literal in a `track("<name>"` call under `src`. */
function trackedNames(): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(/\btrack\(\s*"([a-z_]+)"/g)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names].sort();
}

describe("analyticsEvents", () => {
  it("holds each name once, in snake_case", () => {
    expect(new Set(analyticsEvents).size).toBe(analyticsEvents.length);
    expect(analyticsEvents.filter((name) => !/^[a-z]+(_[a-z]+)*$/.test(name))).toEqual([]);
  });

  it("lists every event name that a track() call in src spells out", () => {
    const tracked = trackedNames();
    expect(tracked.length).toBeGreaterThan(5);
    expect(tracked.filter((name) => !analyticsEvents.some((listed) => listed === name))).toEqual(
      [],
    );
  });
});
