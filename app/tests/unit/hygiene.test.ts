// Repository hygiene, gate G10 (B1b invariants 1 to 16, STANDARDS R02, R54, R56 to R59). It
// catches accidents only: a pull request can edit this test as easily as a workflow.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { isMap, isScalar, parse, parseDocument } from "yaml";
import { z } from "zod";

const APP = resolve(import.meta.dirname, "../..");
const ROOT = resolve(APP, "..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const read = (path: string) => readFileSync(path, "utf8");

const Value = z.union([z.string(), z.number(), z.boolean()]);
const Step = z.object({
  name: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(Value).optional(),
  with: z.record(Value).optional(),
});
const Job = z.object({
  if: z.union([z.string(), z.boolean()]).optional(),
  "timeout-minutes": z.number().optional(),
  concurrency: z.unknown(),
  steps: z.array(Step).default([]),
});
const Workflow = z.object({
  name: z.string().optional(),
  on: z.record(z.unknown()),
  permissions: z.unknown(),
  defaults: z.object({ run: z.object({ "working-directory": z.string() }) }).optional(),
  concurrency: z.unknown(),
  jobs: z.record(Job),
});
const PullRequestTrigger = z.object({ pull_request: z.object({ types: z.array(z.string()) }) });
const PackageJson = z.object({
  engines: z.object({ bun: z.string(), node: z.string() }),
  scripts: z.record(z.string()),
});

/**
 * A job's raw text is the slice from its `<name>:` key to the next job key. The workflow's own
 * text is everything outside the `jobs:` map: its `env:` and `concurrency:` reach every job.
 */
function splitWorkflow(text: string): { head: string; jobText: Map<string, string> } {
  const root = parseDocument(text).contents;
  const jobsPair = isMap(root)
    ? root.items.find((pair) => isScalar(pair.key) && pair.key.value === "jobs")
    : undefined;
  const jobs = jobsPair?.value;
  if (!isScalar(jobsPair?.key) || !isMap(jobs)) throw new Error("workflow has no jobs map");
  const end = jobs.range[2];
  const starts = jobs.items.map((pair) => {
    if (!isScalar(pair.key)) throw new Error("job key is not a scalar");
    return { name: String(pair.key.value), start: pair.key.range[0] };
  });
  return {
    head: text.slice(0, jobsPair.key.range[0]) + text.slice(end),
    jobText: new Map(
      starts.map(({ name, start }, index) => [
        name,
        text.slice(start, starts[index + 1]?.start ?? end),
      ]),
    ),
  };
}

const workflows = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort()
  .map((file) => {
    const text = read(join(WORKFLOWS, file));
    return { file, text, data: Workflow.parse(parse(text)), ...splitWorkflow(text) };
  });
type WorkflowFile = (typeof workflows)[number];
type JobDef = z.infer<typeof Job>;

const named = (file: string) => workflows.find((workflow) => workflow.file === file);
const jobsOf = (workflow: WorkflowFile) => Object.entries(workflow.data.jobs);
const textOf = (workflow: WorkflowFile | undefined, job: string) =>
  workflow?.jobText.get(job) ?? "";

const ci = named("ci.yml");
const deploy = named("deploy.yml");
const backup = named("backup.yml");
const MERGE_GATE = join(APP, "scripts/merge-gate.mjs");
const JOB_RUNNER = join(APP, "supabase/functions/job-runner/index.ts");

/** Invariant 15: a job is out of a pull request's reach only when every `||` branch of its `if:` names another event. */
const OTHER_EVENT = /^\(*\s*github\.event_name == '(workflow_run|push|workflow_dispatch)'/;
function pullRequestReaches(workflow: WorkflowFile, job: JobDef): boolean {
  if (!("pull_request" in workflow.data.on)) return false;
  const condition = typeof job.if === "string" ? job.if.replace(/^\$\{\{|\}\}$/g, "").trim() : "";
  if (condition === "") return true;
  return !condition.split("||").every((branch) => OTHER_EVENT.test(branch.trim()));
}

/** Invariant 15: a step calls gh when its run: does, or when it runs a script that spawns gh. */
const GH_COMMAND = /(^|[\s;&|(`])gh\s+[a-z]/m;
const GH_SPAWN = /["'`]gh["'`]|`gh\s/;
const TOKEN_ELSEWHERE = /GH_TOKEN=|GITHUB_TOKEN=|gh auth login|\$\{\{\s*(secrets\.|github\.token)/;
function callsGh(run: string): boolean {
  const scripts = [...run.matchAll(/\bnode\s+([\w./-]+\.m?js)\b/g)].flatMap((match) =>
    match[1] === undefined ? [] : [join(APP, match[1])],
  );
  return (
    GH_COMMAND.test(run) || scripts.some((path) => existsSync(path) && GH_SPAWN.test(read(path)))
  );
}

const packageJson = PackageJson.parse(JSON.parse(read(join(APP, "package.json"))));

describe("toolchain (GS-07)", () => {
  it("package.json engines pins bun to a version and node to a major", () => {
    const { bun, node } = packageJson.engines;
    expect({ bun: /^\d+\.\d+\.\d+$/.test(bun), node: /^\d+\.x$/.test(node) }).toEqual({
      bun: true,
      node: true,
    });
  });

  it("bun.lock exists", () => {
    expect(existsSync(join(APP, "bun.lock"))).toBe(true);
  });

  it("every workflow pins the bun and node versions of engines", () => {
    const { bun, node } = packageJson.engines;
    const mismatches: string[] = [];
    let pins = 0;
    for (const workflow of workflows) {
      for (const [name, job] of jobsOf(workflow)) {
        for (const step of job.steps) {
          const where = `${workflow.file} ${name}`;
          if (step.uses?.startsWith("oven-sh/setup-bun@")) {
            pins += 1;
            const pinned = String(step.with?.["bun-version"]);
            if (pinned !== bun) mismatches.push(`${where} setup-bun ${pinned}, engines.bun ${bun}`);
          }
          if (step.uses?.startsWith("actions/setup-node@")) {
            pins += 1;
            const pinned = `${String(step.with?.["node-version"])}.x`;
            if (pinned !== node)
              mismatches.push(`${where} setup-node ${pinned}, engines.node ${node}`);
          }
          if (step.env?.["BUN_PIN"] !== undefined) {
            pins += 1;
            const pinned = String(step.env["BUN_PIN"]);
            if (pinned !== bun) mismatches.push(`${where} BUN_PIN ${pinned}, engines.bun ${bun}`);
          }
        }
      }
    }
    expect({ mismatches, pinned: pins > 0 }).toEqual({ mismatches: [], pinned: true });
  });

  it("Dependabot updates the app (bun) and the workflows (github-actions) weekly", () => {
    const config = z
      .object({
        updates: z.array(
          z.object({
            "package-ecosystem": z.string(),
            directory: z.string(),
            schedule: z.object({ interval: z.string() }),
          }),
        ),
      })
      .parse(parse(read(join(ROOT, ".github/dependabot.yml"))));
    expect(
      config.updates.map(
        (update) =>
          `${update["package-ecosystem"]} ${update.directory} ${update.schedule.interval}`,
      ),
    ).toEqual(["bun /app weekly", "github-actions / weekly"]);
  });

  it("bunfig.toml keeps minimumReleaseAge of at least 86400", () => {
    const age = /^minimumReleaseAge\s*=\s*(\d+)/m.exec(read(join(APP, "bunfig.toml")))?.[1];
    expect(Number(age)).toBeGreaterThanOrEqual(86400);
  });
});

describe("workflows (invariants 1, 8, 13 to 15; R54, R56, R58)", () => {
  it("nothing under the app is named .github and every workflow runs in app (G-012)", () => {
    expect({
      nested: existsSync(join(APP, ".github")),
      directories: workflows.map((w) => [w.file, w.data.defaults?.run["working-directory"]]),
    }).toEqual({ nested: false, directories: workflows.map((w) => [w.file, "app"]) });
  });

  it("every uses: is pinned to a 40-character commit SHA with a version comment", () => {
    const lines = workflows.flatMap((w) =>
      w.text
        .split("\n")
        .filter((line) => /^\s*(-\s+)?uses:/.test(line))
        .map((line) => `${w.file}: ${line.trim()}`),
    );
    const unpinned = lines.filter(
      (line) => !/uses: (\.\/\S+|[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*)$/.test(line),
    );
    expect({ unpinned, checked: lines.length > 0 }).toEqual({ unpinned: [], checked: true });
  });

  it("every workflow sets top-level permissions: {}", () => {
    expect(workflows.map((w) => [w.file, w.data.permissions])).toEqual(
      workflows.map((w) => [w.file, {}]),
    );
  });

  it("every actions/checkout sets persist-credentials: false", () => {
    const loose = workflows.flatMap((w) =>
      jobsOf(w).flatMap(([name, job]) =>
        job.steps
          .filter((step) => step.uses?.startsWith("actions/checkout@"))
          .filter((step) => step.with?.["persist-credentials"] !== false)
          .map(() => `${w.file} ${name}`),
      ),
    );
    expect(loose).toEqual([]);
  });

  it("a step that calls gh reads GH_TOKEN from its env and nowhere else (15)", () => {
    const loose = workflows.flatMap((w) =>
      jobsOf(w).flatMap(([name, job]) =>
        job.steps
          .filter((step) => callsGh(step.run ?? ""))
          .filter(
            (step) => step.env?.["GH_TOKEN"] === undefined || TOKEN_ELSEWHERE.test(step.run ?? ""),
          )
          .map((step) => `${w.file} ${name}: ${step.name ?? step.run ?? ""}`),
      ),
    );
    expect(loose).toEqual([]);
  });

  it("no job a pull request can reach references a database, production or backup secret", () => {
    const leaks = workflows.flatMap((w) => {
      const reachable = jobsOf(w).filter(([, job]) => pullRequestReaches(w, job));
      const texts = reachable.map(([name]) => ({ where: name, text: textOf(w, name) }));
      const scanned =
        reachable.length > 0 ? [{ where: "(workflow)", text: w.head }, ...texts] : texts;
      return scanned.flatMap(({ where, text }) =>
        ["SUPABASE_ACCESS_TOKEN", "secrets.DEV_SUPABASE_", "secrets.PROD_", "secrets.BACKUP_"]
          .filter((secret) => text.includes(secret))
          .map((secret) => `${w.file} ${where}: ${secret}`),
      );
    });
    expect(leaks).toEqual([]);
  });

  it("no run: line holds attacker-controllable context (R54)", () => {
    const UNTRUSTED =
      /\$\{\{[^}]*(github\.event\.[\w.]*\b(title|body)\b|head\.ref|github\.head_ref|inputs\.)/;
    const hits = workflows.flatMap((w) =>
      jobsOf(w).flatMap(([name, job]) =>
        job.steps
          .flatMap((step) => (step.run ?? "").split("\n"))
          .filter((line) => UNTRUSTED.test(line))
          .map((line) => `${w.file} ${name}: ${line.trim()}`),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("every bun install in a workflow is --frozen-lockfile (R54)", () => {
    const installs = workflows.flatMap((w) =>
      jobsOf(w).flatMap(([name, job]) =>
        job.steps
          .flatMap((step) => (step.run ?? "").split("\n"))
          .filter((line) => /\bbun\s+(install|i)\b/.test(line))
          .map((line) => ({ where: `${w.file} ${name}: ${line.trim()}`, line })),
      ),
    );
    expect({
      loose: installs.filter(({ line }) => !line.includes("--frozen-lockfile")).map((i) => i.where),
      checked: installs.length > 0,
    }).toEqual({ loose: [], checked: true });
  });

  it("no workflow names R2 or a media base variable (H33)", () => {
    const hits = workflows.flatMap((w) =>
      ["R2_", "wrangler r2", "MEDIA_BASE_URL"]
        .filter((word) => w.text.includes(word))
        .map((word) => `${w.file}: ${word}`),
    );
    expect(hits).toEqual([]);
  });

  it("no ci.yml job reads or writes mop-dev, workflow env included (13)", () => {
    const text = ci?.text ?? "";
    const hits = [
      ...(/group:\s*["']?mop-dev/.test(text) ? ["group: mop-dev"] : []),
      ...["DEV_SUPABASE_", "SUPABASE_ACCESS_TOKEN"].filter((word) => text.includes(word)),
    ];
    expect({ ci: ci !== undefined, hits }).toEqual({ ci: true, hits: [] });
  });

  it("the check job compares the runner with engines before installing (8)", () => {
    const steps = ci?.data.jobs["check"]?.steps ?? [];
    const engines = steps.findIndex((step) => step.name === "engines");
    const install = steps.findIndex((step) => step.run?.includes("bun install") === true);
    const script = /^node -e "(.*)"$/s.exec(steps[engines]?.run?.trim() ?? "")?.[1] ?? "";
    const runWith = (pin: string) =>
      spawnSync(process.execPath, ["-e", script], {
        cwd: APP,
        env: { ...process.env, BUN_PIN: pin },
        encoding: "utf8",
      });
    const refused = runWith("0.0.1");
    expect({
      beforeInstall: engines >= 0 && engines < install,
      matchExit: runWith(packageJson.engines.bun).status,
      mismatchExit: refused.status,
      namesEngines: refused.stderr.includes("engines"),
    }).toEqual({ beforeInstall: true, matchExit: 0, mismatchExit: 1, namesEngines: true });
  });

  it("every job sets timeout-minutes", () => {
    const missing = workflows.flatMap((w) =>
      jobsOf(w)
        .filter(([, job]) => job["timeout-minutes"] === undefined)
        .map(([name]) => `${w.file} ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("every workflow has a workflow-level concurrency or one on every job", () => {
    const missing = workflows
      .filter(
        (w) =>
          w.data.concurrency === undefined &&
          jobsOf(w).some(([, job]) => job.concurrency === undefined),
      )
      .map((w) => w.file);
    expect(missing).toEqual([]);
  });

  it("the heavy jobs skip drafts and obey CI_HEAVY", () => {
    const loose = workflows.flatMap((w) =>
      jobsOf(w)
        .filter(([name]) => ["db", "e2e", "preview"].includes(name))
        .filter(([, job]) => {
          const condition = typeof job.if === "string" ? job.if : "";
          return !(
            condition.includes("github.event.pull_request.draft == false") &&
            condition.includes("vars.CI_HEAVY != 'off'")
          );
        })
        .map(([name]) => `${w.file} ${name}`),
    );
    expect(loose).toEqual([]);
  });

  it("ci.yml is named ci and runs on pull requests marked ready for review", () => {
    expect({
      name: ci?.data.name,
      ready: PullRequestTrigger.parse(ci?.data.on).pull_request.types.includes("ready_for_review"),
    }).toEqual({ name: "ci", ready: true });
  });

  it("bun run build runs in exactly one ci.yml job", () => {
    const building = Object.keys(ci?.data.jobs ?? {}).filter((name) =>
      textOf(ci, name).includes("bun run build"),
    );
    expect(building).toHaveLength(1);
  });
});

describe.skipIf(deploy === undefined)("deploy.yml (skipped until step 6 writes it)", () => {
  it("preview refuses forks and Dependabot (invariants 6 and 8)", () => {
    const condition = String(deploy?.data.jobs["preview"]?.if);
    expect([
      condition.includes("github.event.pull_request.head.repo.full_name == github.repository"),
      condition.includes("dependabot[bot]"),
    ]).toEqual([true, true]);
  });

  it("production deploys only what ci passed on main (invariant 6a)", () => {
    const text = deploy?.text ?? "";
    expect([
      text.includes("workflow_run"),
      text.includes("workflows: [ci]"),
      text.includes("conclusion == 'success'"),
      PullRequestTrigger.parse(deploy?.data.on).pull_request.types.includes("ready_for_review"),
    ]).toEqual([true, true, true, true]);
  });

  it("dev deploys matter-of-place-dev and preview and dev switch on HAS_DB (G19, 13a)", () => {
    const has = (job: string, needle: string) => textOf(deploy, job).includes(needle);
    expect([
      has("dev", "--name matter-of-place-dev"),
      has("dev", "MOP_ENV:${{ env.HAS_DB == 'true' && 'preview' || 'local' }}"),
      ...["preview", "dev"].flatMap((job) => [
        has(job, "HAS_DB: ${{ fromJSON(secrets.PREVIEW_WORKER_SECRETS_JSON).SUPABASE_URL != '' }}"),
        has(job, "VITE_API_BASE_URL: ${{ env.HAS_DB == 'true' && vars.VITE_API_BASE_URL || '' }}"),
      ]),
      ...["preview", "dev", "production"].map((job) => has(job, "--var MEDIA_PUBLIC_BASE:")),
    ]).toEqual(Array<boolean>(9).fill(true));
  });

  it("production needs dev, and neither production nor preview-db touches the database (13)", () => {
    const touches = ["production", "preview-db"].flatMap((job) =>
      ["db:push", "supabase link", "functions deploy"]
        .filter((word) => textOf(deploy, job).includes(word))
        .map((word) => `${job}: ${word}`),
    );
    expect({ needsDev: textOf(deploy, "production").includes("needs: dev"), touches }).toEqual({
      needsDev: true,
      touches: [],
    });
  });

  it("production and dev never read CI_HEAVY (invariant 14)", () => {
    expect(["production", "dev"].filter((job) => textOf(deploy, job).includes("CI_HEAVY"))).toEqual(
      [],
    );
  });
});

describe.skipIf(backup === undefined)("backup.yml (skipped until step 8 writes it)", () => {
  it("encrypts to the public certificate and records the run (DO-02, G32, 17, DB-11)", () => {
    const text = backup?.text ?? "";
    const present = [
      "openssl cms -encrypt",
      "backup-recipient.pem",
      "mop-${{ env.TARGET }}-dump",
      "select claim_schedule('backup', false, null, now(), null)",
      "select beat('backup'",
      "--exclude-table-data='public.analytics_events*'",
    ].filter((needle) => !text.includes(needle));
    const absent = ["BACKUP_PASSPHRASE", "CI_HEAVY"].filter((needle) => text.includes(needle));
    expect({ present, absent, update: /update schedule_settings/i.test(text) }).toEqual({
      present: [],
      absent: [],
      update: false,
    });
  });

  it("offers only the dev target and keeps the artifact 14 or 30 days (H35, DB-11)", () => {
    const options = z
      .object({
        workflow_dispatch: z.object({
          inputs: z.object({ target: z.object({ options: z.array(z.string()) }) }),
        }),
      })
      .parse(backup?.data.on).workflow_dispatch.inputs.target.options;
    const retention = Object.values(backup?.data.jobs ?? {})
      .flatMap((job) => job.steps)
      .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
      .map((step) => step.with?.["retention-days"]);
    expect({ options, retention: retention.every((days) => days === 14 || days === 30) }).toEqual({
      options: ["dev"],
      retention: true,
    });
  });
});

describe.skipIf(!existsSync(MERGE_GATE))(
  "merge gate (invariant 6b; skipped until step 5b writes scripts/merge-gate.mjs)",
  () => {
    it("every pull request job of ci.yml, and deploy.yml's preview, is a required check", async () => {
      const { REQUIRED_PR_CHECKS } = z
        .object({ REQUIRED_PR_CHECKS: z.array(z.string()) })
        .parse(await import(pathToFileURL(MERGE_GATE).href));
      const reachable = Object.entries(ci?.data.jobs ?? {})
        .filter(([, job]) => ci !== undefined && pullRequestReaches(ci, job))
        .map(([name]) => name);
      const jobs = deploy === undefined ? reachable : [...reachable, "preview"];
      expect({
        mergeGateJob: Object.keys(ci?.data.jobs ?? {}).includes("merge-gate"),
        unlisted: jobs.filter((name) => !REQUIRED_PR_CHECKS.includes(name)),
      }).toEqual({ mergeGateJob: true, unlisted: [] });
    });
  },
);

describe.skipIf(!existsSync(JOB_RUNNER))("job runner (skipped until B8 writes it)", () => {
  it("commits deno.lock beside the job runner (R54)", () => {
    expect(existsSync(join(APP, "supabase/functions/job-runner/deno.lock"))).toBe(true);
  });
});

describe("pull request template (S35, R57)", () => {
  it("names every extension path of tech-stack section 5", () => {
    const template = read(join(ROOT, ".github/pull_request_template.md"));
    const labels = [
      "public page",
      "API route",
      "admin action",
      "table or column",
      "job type",
      "email",
      "analytics event",
      "role or permission",
      "social or email channel",
      "new public read",
      "none: tooling or docs only",
    ];
    expect(labels.filter((label) => !template.includes(`- [ ] ${label}\n`))).toEqual([]);
  });
});

describe("wrangler.toml (invariant 2, G-011, R59)", () => {
  it("holds no secret and no paid binding", () => {
    const text = read(join(APP, "wrangler.toml"));
    const words = ["queues", "browser", "images", "durable", "kv_namespaces", "secret", "token"];
    expect([
      ...words.filter((word) => text.toLowerCase().includes(word)),
      ...(/key\s*=/i.test(text) ? ["key ="] : []),
    ]).toEqual([]);
  });
});

describe("code gates (invariant 16; R01, R36, R48)", () => {
  const SEVERITY = z.array(z.unknown()).transform((rule) => rule[0]);
  const Resolved = z.object({
    linterOptions: z.object({ reportUnusedDisableDirectives: z.number() }),
    languageOptions: z.object({ parserOptions: z.object({ projectService: z.boolean() }) }),
    rules: z.record(SEVERITY),
  });

  it("lint is type-aware, zero-warning and refuses the named rules", async () => {
    const eslint = new ESLint({ cwd: APP });
    const source = Resolved.parse(await eslint.calculateConfigForFile("src/start.ts"));
    const test = Resolved.parse(await eslint.calculateConfigForFile("tests/unit/hygiene.test.ts"));
    expect({
      strictTypeChecked: read(join(APP, "eslint.config.js")).includes("strictTypeChecked"),
      projectService: source.languageOptions.parserOptions.projectService,
      unusedDisable: source.linterOptions.reportUnusedDisableDirectives,
      floating: source.rules["@typescript-eslint/no-floating-promises"],
      exhaustive: source.rules["@typescript-eslint/switch-exhaustiveness-check"],
      throws: source.rules["@typescript-eslint/only-throw-error"],
      console: source.rules["no-console"],
      focused: test.rules["vitest/no-focused-tests"],
      maxWarnings: packageJson.scripts["lint"]?.includes("--max-warnings 0"),
    }).toEqual({
      strictTypeChecked: true,
      projectService: true,
      unusedDisable: 2,
      floating: 2,
      exhaustive: 2,
      throws: 2,
      console: 2,
      focused: 2,
      maxWarnings: true,
    });
  });

  it("only src/server/lib/crypto.ts calls crypto.subtle (CS-04)", () => {
    const callers = readdirSync(join(APP, "src"), { recursive: true, encoding: "utf8" })
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => /\.tsx?$/.test(path) && path !== "server/lib/crypto.ts")
      .filter((path) => read(join(APP, "src", path)).includes("crypto.subtle"));
    expect(callers).toEqual([]);
  });
});

describe("compiler (R02, G10)", () => {
  const Tsconfig = z.object({
    extends: z.string().optional(),
    compilerOptions: z.record(z.unknown()),
  });
  const FLAGS = [
    "strict",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "noPropertyAccessFromIndexSignature",
    "noImplicitReturns",
    "noImplicitOverride",
    "noUnusedLocals",
    "noUnusedParameters",
    "noUncheckedSideEffectImports",
    "verbatimModuleSyntax",
  ];

  it("tsconfig.json keeps every strict flag on", () => {
    const options = Tsconfig.parse(JSON.parse(read(join(APP, "tsconfig.json")))).compilerOptions;
    expect(FLAGS.filter((flag) => options[flag] !== true)).toEqual([]);
  });

  it("tsconfig.scripts.json extends tsconfig.json and checks JavaScript", () => {
    const scripts = Tsconfig.parse(JSON.parse(read(join(APP, "tsconfig.scripts.json"))));
    expect([scripts.extends, scripts.compilerOptions["checkJs"]]).toEqual([
      "./tsconfig.json",
      true,
    ]);
  });
});
