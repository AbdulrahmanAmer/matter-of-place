import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  gaugeStatus,
  P009_LIMITS,
  THRESHOLDS,
  type GaugeLine,
} from "../../../src/server/audit/gauges";
import { gaugeStatus as gaugeStatusMjs } from "../../../../workspace/audits/tools/usage.mjs";

// B14 step 5, invariant 7 (GS-06): `limits.json` is the one table, `gauges.ts` its mirror for the daily health job.
const limitsSchema = z.object({
  thresholds: z.object({ watch: z.number(), decision: z.number(), limit: z.number() }),
  lines: z.array(
    z.object({
      line: z.string(),
      limit: z.number().nullable(),
      unit: z.string(),
      source: z.string(),
      kind: z.enum(["vendor", "info", "guideline"]),
    }),
  ),
});

const limits = limitsSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/limits.json", import.meta.url),
      "utf8",
    ),
  ),
);

const lineNamed = (name: string): GaugeLine => {
  const found = P009_LIMITS.find((candidate) => candidate.line === name);
  if (found === undefined) throw new Error(`gauges.ts has no line ${name}`);
  return found;
};

const hundred: GaugeLine = {
  line: "probe",
  limit: 100,
  unit: "units",
  source: "ours.mjs",
  kind: "vendor",
};

describe("limits.json and gauges.ts", () => {
  it("hold the same lines, limits, units, sources, kinds and thresholds", () => {
    expect(P009_LIMITS).toEqual(limits.lines);
    expect(THRESHOLDS).toEqual(limits.thresholds);
  });

  it("answer the same status and percent as usage.mjs for every line at every step", () => {
    for (const line of limits.lines) {
      for (const percent of [0, 49, 50, 69, 70, 89, 90, 100, 150]) {
        const used = Math.ceil(((line.limit ?? 1000) * percent) / 100);
        expect(gaugeStatus(line, used), `${line.line} at ${String(percent)}`).toEqual(
          gaugeStatusMjs(line, used),
        );
      }
    }
  });
});

describe("gaugeStatus", () => {
  it.each([
    [49, "ok"],
    [50, "watch"],
    [69, "watch"],
    [70, "DECISION"],
    [89, "DECISION"],
    [90, "LIMIT"],
    [120, "LIMIT"],
  ])("puts %d percent of a vendor limit at %s", (used, status) => {
    expect(gaugeStatus(hundred, used)).toEqual({ percent: used, status });
  });

  it("gives a guideline line only ok or watch: reels_month is ok at 10 and watch at 11", () => {
    const reels = lineNamed("reels_month");
    expect(reels).toMatchObject({ kind: "guideline", limit: 10 });
    expect(gaugeStatus(reels, 10).status).toBe("ok");
    expect(gaugeStatus(reels, 11).status).toBe("watch");
    expect(gaugeStatus(reels, 1000).status).toBe("watch");
  });

  it("gives an info line only info: caption_tokens never reaches DECISION (H34)", () => {
    const tokens = lineNamed("caption_tokens");
    expect(tokens).toMatchObject({ kind: "info", limit: null });
    expect(gaugeStatus(tokens, 0).status).toBe("info");
    expect(gaugeStatus(tokens, 5_000_000_000).status).toBe("info");
  });

  it("holds the Storage walls of H33 (8): 1 GB stored and 5 GB a month of egress", () => {
    expect(lineNamed("storage_bytes")).toMatchObject({ limit: 1024 ** 3, source: "ours.mjs" });
    expect(lineNamed("storage_egress")).toMatchObject({
      limit: 5 * 1024 ** 3,
      source: "Supabase usage report",
    });
  });

  it("holds actions_minutes at 2000 a month and calls 1,400 minutes a DECISION (DO-08)", () => {
    const minutes = lineNamed("actions_minutes");
    expect(minutes).toMatchObject({ limit: 2000, source: "github.mjs" });
    expect(gaugeStatus(minutes, 1400).status).toBe("DECISION");
  });
});
