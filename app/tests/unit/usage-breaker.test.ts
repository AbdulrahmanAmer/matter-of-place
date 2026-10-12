import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { breakerUntil, usageLimitOf } from "../../scripts/workforce/cli.ts";

// Gap audit item 32: when the operator's Claude limit is spent, runs wait for the reset instead of failing for good.

describe("the usage-limit breaker", () => {
  const now = new Date("2026-10-12T06:00:00Z");

  it("reads the reset time the CLI prints, an hour when it gives none, and ignores other answers", () => {
    expect([
      usageLimitOf("Claude AI usage limit reached|1760284800", now)?.toISOString(),
      usageLimitOf("You have reached your weekly limit.", now)?.toISOString(),
      usageLimitOf('{"result":"Here is the plan"}', now),
    ]).toEqual(["2025-10-12T16:00:00.000Z", "2026-10-12T07:00:00.000Z", null]);
  });

  it("holds until the reset and forgets an expired or unreadable breaker", () => {
    const dir = mkdtempSync(join(tmpdir(), "breaker-"));
    const ahead = join(dir, "ahead.json");
    const past = join(dir, "past.json");
    const broken = join(dir, "broken.json");
    writeFileSync(ahead, JSON.stringify({ until: "2026-10-12T09:00:00Z" }));
    writeFileSync(past, JSON.stringify({ until: "2026-10-12T05:00:00Z" }));
    writeFileSync(broken, "{");
    expect([
      breakerUntil(ahead, now)?.toISOString(),
      breakerUntil(past, now),
      breakerUntil(broken, now),
      breakerUntil(join(dir, "none.json"), now),
    ]).toEqual(["2026-10-12T09:00:00.000Z", null, null, null]);
  });
});
