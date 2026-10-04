import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isImplemented,
  listStepSpecs,
  type StepRegistry,
} from "../../../src/server/automation/catalog";
import { defaultMaxAttempts, type StepSpec } from "../../../src/server/automation/step-specs";
import { getStep } from "../../../src/server/jobs/steps/index";
import { listSystemJobs } from "../../../src/server/jobs/system/index";

const SIDE_EFFECTS = ["none", "idempotency_key", "begin_row", "remote_lookup", "sql_guard"];
const OUTSIDE_STEPS = [
  "send_email",
  "notify_admin",
  "post_meta",
  "post_x",
  "post_linkedin",
  "webhook_omnikom",
  "write_captions",
  "render_variants",
  "render_cover",
  "render_carousel",
  "render_story",
  "render_reel",
  "render_og_static",
];
const OUTSIDE_SYSTEM_JOBS = ["invoice_pdf", "market_open_notice", "newsletter_send"];
const LIGHT_STEPS = [
  "bump_catalog_version",
  "purge_cache",
  "build_newsletter_block",
  "queue_digest",
];

const testsRoot = fileURLToPath(new URL("../../", import.meta.url));

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// The titles of every `it(...)` and `test(...)` under tests/, read from the source so a renamed title is seen.
function testTitles(): string[] {
  return testFiles(testsRoot).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:it|test)\(\s*(["'`])(.+?)\1/g)].map(
      (match) => match[2] ?? "",
    ),
  );
}

// R28: a type with an outside effect that has a module in the registry needs its run-twice test.
function missingRunTwiceTests(registry: StepRegistry, titles: readonly string[]): string[] {
  return listStepSpecs()
    .filter((spec) => spec.sideEffect !== "none" && isImplemented(spec.type, registry))
    .map((spec) => spec.type)
    .filter((type) => !titles.includes(`${type} runs twice without a second outside effect`));
}

describe("step specs", () => {
  it("gives every outside provider type maxAttempts of 10 or more", () => {
    const specs = new Map<string, StepSpec>(listStepSpecs().map((spec) => [spec.type, spec]));
    for (const type of OUTSIDE_STEPS) {
      expect({ type, attempts: (specs.get(type)?.maxAttempts ?? 0) >= 10 }).toEqual({
        type,
        attempts: true,
      });
    }
    const registered = listSystemJobs().filter((job) => OUTSIDE_SYSTEM_JOBS.includes(job.type));
    expect(registered.filter((job) => (job.maxAttempts ?? 0) < 10).map((job) => job.type)).toEqual(
      [],
    );
  });

  it("leaves the four light steps on the default attempts", () => {
    for (const type of LIGHT_STEPS) {
      const spec = listStepSpecs().find((candidate) => candidate.type === type);
      expect({ type, attempts: spec?.maxAttempts ?? defaultMaxAttempts }).toEqual({
        type,
        attempts: 5,
      });
    }
  });

  it("sets local on write_captions only and never with heavy", () => {
    const local = listStepSpecs().filter((spec) => spec.local === true);
    expect(local.map((spec) => spec.type)).toEqual(["write_captions"]);
    expect(listStepSpecs().filter((spec) => spec.local === true && spec.heavy)).toEqual([]);
  });

  it("marks the six render steps heavy and no other", () => {
    const heavy = listStepSpecs()
      .filter((spec) => spec.heavy)
      .map((spec) => spec.type);
    expect(heavy).toEqual([
      "render_variants",
      "render_cover",
      "render_carousel",
      "render_story",
      "render_reel",
      "render_og_static",
    ]);
  });

  it("declares a sideEffect on every spec and every system type", () => {
    const undeclared = [...listStepSpecs(), ...listSystemJobs()]
      .filter((entry) => !SIDE_EFFECTS.includes(entry.sideEffect))
      .map((entry) => entry.type);
    expect(undeclared).toEqual([]);
    expect(listSystemJobs().length).toBeGreaterThan(0);
  });

  it("finds a run-twice test for every implemented type with an outside effect", () => {
    expect(missingRunTwiceTests(getStep, testTitles())).toEqual([]);
  });

  it("names a type whose run-twice test is missing", () => {
    const implemented: StepRegistry = (type) => (type === "send_email" ? {} : undefined);
    expect(missingRunTwiceTests(implemented, [])).toEqual(["send_email"]);
    expect(
      missingRunTwiceTests(implemented, ["send_email runs twice without a second outside effect"]),
    ).toEqual([]);
    expect(missingRunTwiceTests(() => undefined, [])).toEqual([]);
  });
});
