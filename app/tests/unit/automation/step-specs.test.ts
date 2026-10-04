import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isImplemented,
  listStepSpecs,
  type StepRegistry,
} from "../../../src/server/automation/catalog";
import { defaultMaxAttempts, type StepSpec } from "../../../src/server/automation/step-specs";
import { getStep } from "../../../src/server/jobs/steps/index";
import { listSystemJobs } from "../../../src/server/jobs/system/index";

const reportSchema = z.object({
  testResults: z.array(
    z.object({ assertionResults: z.array(z.object({ status: z.string(), title: z.string() })) }),
  ),
});

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

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const selfPath = fileURLToPath(import.meta.url);
const RUN_TWICE = "runs twice";

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// The titles vitest runs for the run-twice cases, as its json reporter prints them: a title written through
// `it.each` with a `$type` placeholder is read as one title per row, which no scan of the source can do.
// Only the unit and component projects are asked (the db project needs the database), and only the files that
// carry the words, so the child run stays short.
function testTitles(): string[] {
  const files = ["tests/unit", "src"]
    .flatMap((dir) => testFiles(join(appRoot, dir)))
    .filter((file) => file !== selfPath && readFileSync(file, "utf8").includes(RUN_TWICE));
  const outDir = mkdtempSync(join(tmpdir(), "run-twice-"));
  const outFile = join(outDir, "report.json");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
  );
  const child = spawnSync(
    process.execPath,
    [
      join(appRoot, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--project=unit",
      "--project=component",
      `--testNamePattern=${RUN_TWICE}`,
      "--reporter=json",
      `--outputFile=${outFile}`,
      ...files,
    ],
    { cwd: appRoot, env, encoding: "utf8" },
  );
  try {
    const report = reportSchema.parse(JSON.parse(readFileSync(outFile, "utf8")));
    return report.testResults.flatMap((file) =>
      file.assertionResults
        .filter((result) => result.status === "passed" || result.status === "failed")
        .map((result) => result.title),
    );
  } catch (error) {
    throw new Error(`vitest json report unreadable: ${child.stderr}`, { cause: error });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
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
  }, 60000);

  it("names a type whose run-twice test is missing", () => {
    const implemented: StepRegistry = (type) => (type === "send_email" ? {} : undefined);
    expect(missingRunTwiceTests(implemented, [])).toEqual(["send_email"]);
    expect(
      missingRunTwiceTests(implemented, ["send_email runs twice without a second outside effect"]),
    ).toEqual([]);
    expect(missingRunTwiceTests(() => undefined, [])).toEqual([]);
  });
});
