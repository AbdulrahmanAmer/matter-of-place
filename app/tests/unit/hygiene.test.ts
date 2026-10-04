// Repository hygiene, gate G10 (B1b invariants 1 to 16, STANDARDS R02, R54, R56 to R59). It
// catches accidents only: a pull request can edit this test as easily as a workflow.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isMap, isScalar, parse, parseDocument } from "yaml";
import { z } from "zod";
import { REQUIRED_PR_CHECKS, jobKeys } from "../../scripts/merge-gate.mjs";

const APP = resolve(import.meta.dirname, "../..");
const ROOT = resolve(APP, "..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const read = (path: string) => readFileSync(path, "utf8");

const Value = z.union([z.string(), z.number(), z.boolean()]);
const Step = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(Value).optional(),
  with: z.record(Value).optional(),
});
const Job = z.object({
  if: z.union([z.string(), z.boolean()]).optional(),
  "timeout-minutes": z.number().optional(),
  permissions: z.record(z.string()).optional(),
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

  it("the test script gives every test and hook 60 s on a loaded laptop (H49 (3))", () => {
    expect(packageJson.scripts["test"]).toContain("--testTimeout=60000");
    expect(packageJson.scripts["test"]).toContain("--hookTimeout=60000");
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

const HEAVY_IF =
  "if: github.event_name == 'pull_request' && github.event.pull_request.draft == false && vars.CI_HEAVY != 'off'";
const DATABASE_JOBS = ["db", "e2e"];

describe("ci.yml db and e2e (B4 steps 7 and 8; DO-08, T-01, T-04, T-12)", () => {
  it("each carries the heavy-job condition verbatim and a timeout", () => {
    const loose = DATABASE_JOBS.filter((job) => {
      const text = textOf(ci, job);
      return !text.includes(HEAVY_IF) || !/^ {4}timeout-minutes: \d+$/m.test(text);
    });
    expect(loose).toEqual([]);
  });

  it("each starts a stack of its own and reads no secret", () => {
    const loose = DATABASE_JOBS.filter((job) => {
      const text = textOf(ci, job);
      return !text.includes("bunx supabase start -x ") || text.includes("secrets.");
    });
    expect(loose).toEqual([]);
  });

  it("no job names the shared database's group or project, or sweeps in local mode", () => {
    const FORBIDDEN = [
      /group:\s*["']?mop-dev/,
      /DEV_SUPABASE_PROJECT_REF/,
      /E2E_MODE(=|:\s*)local/,
    ];
    const hits = [...(ci?.jobText ?? [])].flatMap(([job, text]) =>
      FORBIDDEN.filter((word) => word.test(text)).map((word) => `${job}: ${word.source}`),
    );
    expect(hits).toEqual([]);
  });

  it("e2e tests build's artifact and never builds, and a path filter on it keeps src/", () => {
    const text = textOf(ci, "e2e");
    const filters = (ci?.data.jobs["e2e"]?.steps ?? [])
      .flatMap((step) => (step.run ?? "").split("\n"))
      .filter((line) => line.includes("git diff --name-only"));
    expect({
      needs: /^ {4}needs: build$/m.test(text),
      artifact: /actions\/download-artifact@[\s\S]*name: build-output/.test(text),
      builds: text.includes("bun run build"),
      narrow: filters.filter((line) => !/\bsrc\//.test(line)),
    }).toEqual({ needs: true, artifact: true, builds: false, narrow: [] });
  });

  it("every e2e step after the change test waits for it, whatever its own if is", () => {
    const steps = ci?.data.jobs["e2e"]?.steps ?? [];
    const first = steps.findIndex((step) => step.id === "fe");
    const loose = steps
      .slice(first + 1)
      .filter((step) => !(step.if ?? "").includes("steps.fe.outputs.changed == 'true'"))
      .filter((step) => step.if !== "failure()")
      .map((step) => step.name ?? step.uses ?? step.run ?? "");
    expect({ first, loose }).toEqual({ first: 1, loose: [] });
  });

  it("both are required checks of the merge gate", () => {
    expect(DATABASE_JOBS.filter((job) => !REQUIRED_PR_CHECKS.includes(job))).toEqual([]);
  });
});

const PR_JOBS = ["preview-db", "preview", "preview-cleanup"];
const deployJob = (job: string) => deploy?.data.jobs[job];
const has = (job: string, needle: string) => textOf(deploy, job).includes(needle);
const HAS_DB_ENV =
  "HAS_DB: ${{ fromJSON(secrets.PREVIEW_WORKER_SECRETS_JSON).SUPABASE_URL != '' }}";
const API_BASE = "VITE_API_BASE_URL: ${{ env.HAS_DB == 'true' && vars.VITE_API_BASE_URL || '' }}";
const MOP_ENV_FLAG = "--var MOP_ENV:${{ env.HAS_DB == 'true' && 'preview' || 'local' }}";

describe.skipIf(deploy === undefined)("deploy.yml pull request jobs (step 6)", () => {
  it("runs on pull requests into main, marked ready and closed", () => {
    const types = PullRequestTrigger.parse(deploy?.data.on).pull_request.types;
    expect(["ready_for_review", "closed"].filter((type) => !types.includes(type))).toEqual([]);
  });

  it("every pull request job refuses forks and Dependabot (invariants 6 and 8)", () => {
    const loose = PR_JOBS.filter((job) => {
      const condition = String(deployJob(job)?.if);
      return !(
        condition.includes("github.event.pull_request.head.repo.full_name == github.repository") &&
        condition.includes("github.actor != 'dependabot[bot]'")
      );
    });
    expect(loose).toEqual([]);
  });

  it("preview-db and preview skip a closed pull request and cleanup runs only on one", () => {
    expect(PR_JOBS.map((job) => String(deployJob(job)?.if).split(" && ")[0])).toEqual([
      "github.event.action != 'closed'",
      "github.event.action != 'closed'",
      "github.event.action == 'closed'",
    ]);
  });

  it("pull request jobs read only the secrets the plan names (13, 15)", () => {
    const allowed: Record<string, string[]> = {
      "preview-db": [],
      preview: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PREVIEW_WORKER_SECRETS_JSON"],
      "preview-cleanup": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    };
    const extra = PR_JOBS.flatMap((job) =>
      [...textOf(deploy, job).matchAll(/secrets\.(\w+)/g)]
        .map((match) => match[1] ?? "")
        .filter((name) => !(allowed[job] ?? []).includes(name))
        .map((name) => `${job}: ${name}`),
    );
    expect({ extra, preview: has("preview", "secrets.PREVIEW_WORKER_SECRETS_JSON") }).toEqual({
      extra: [],
      preview: true,
    });
  });

  it("the overflow and Lighthouse steps run only for a front-end change, never for a draft (DO-08, T-12)", () => {
    const steps = deployJob("preview")?.steps ?? [];
    const heavy =
      "steps.fe.outputs.changed == 'true' && github.event.pull_request.draft == false && vars.CI_HEAVY != 'off'";
    const guarded = ["overflow", "lighthouse"].map(
      (name) => steps.find((step) => step.name === name)?.if,
    );
    expect(guarded).toEqual([heavy, heavy]);
    expect(steps.find((step) => step.id === "fe")?.run).toContain("^app/(src/|public/");
  });

  it("preview-db comments once, on a changed migration only, and touches no database (13)", () => {
    const comment = deployJob("preview-db")?.steps.find((step) => step.name === "comment");
    const touches = ["db:push", "supabase link", "functions deploy", "supabase "].filter((word) =>
      has("preview-db", word),
    );
    expect({
      diff: has(
        "preview-db",
        `git diff --name-only "$BASE...$HEAD" -- 'supabase/migrations/*.sql'`,
      ),
      when: comment?.if,
      once: comment?.run?.includes(`select(startswith("preview-db:"))`),
      body: comment?.run?.includes(`--body "preview-db: this preview runs against main's schema`),
      touches,
    }).toEqual({
      diff: true,
      when: "steps.migrations.outputs.changed == 'true'",
      once: true,
      body: true,
      touches: [],
    });
  });

  it("preview builds and deploys pr-<n> on the HAS_DB switch with the merge commit (13a, 11)", () => {
    expect({
      env: has("preview", HAS_DB_ENV),
      apiBase: has("preview", API_BASE),
      mopEnv: has("preview", MOP_ENV_FLAG),
      name: has("preview", "--name pr-${{ github.event.number }}"),
      release: has("preview", "--var SENTRY_RELEASE:${{ github.sha }}"),
      media: has(
        "preview",
        "--var MEDIA_PUBLIC_BASE:https://pr-${{ github.event.number }}.holy-meadow-4327.workers.dev/media",
      ),
      turnstile: has("preview", "VITE_TURNSTILE_SITE_KEY: 1x00000000000000000000AA"),
    }).toEqual({
      env: true,
      apiBase: true,
      mopEnv: true,
      name: true,
      release: true,
      media: true,
      turnstile: true,
    });
  });

  it("preview deploys, then sets the secrets, then smokes, then comments", () => {
    const steps = deployJob("preview")?.steps ?? [];
    const at = (test: (run: string) => boolean) => steps.findIndex((step) => test(step.run ?? ""));
    const order = [
      at((run) => run.startsWith("bunx wrangler deploy ")),
      at((run) => run.includes('>> "$GITHUB_ENV"')),
      at((run) => run.includes("bunx wrangler secret bulk --name pr-${{ github.event.number }}")),
      at((run) =>
        run.includes(`curl -s -o /dev/null -D - "$PREVIEW_URL/" | grep -qi '^x-request-id:'`),
      ),
      at((run) => run === 'node scripts/smoke.mjs "$PREVIEW_URL"'),
      at((run) => run.includes('gh pr comment "$PR" --body "preview: $PREVIEW_URL"')),
    ];
    expect({
      found: order.every((index) => index >= 0),
      ordered: order.every((index, i) => i === 0 || index > (order[i - 1] ?? 0)),
      urlDefinitions: (deploy?.text.match(/PREVIEW_URL=/g) ?? []).length,
    }).toEqual({ found: true, ordered: true, urlDefinitions: 1 });
  });

  it("preview waits for ten answers of the Worker in a row before the smoke (P-137)", () => {
    const run = deployJob("preview")?.steps.find((step) => step.name === "wait")?.run ?? "";
    expect({
      resets: /else\s+ok=0\s+fi/.test(run),
      tenInARow: run.includes('if [ "$ok" -ge 10 ]; then'),
      failsAtTheEnd: run.trimEnd().endsWith("exit 1"),
    }).toEqual({ resets: true, tenInARow: true, failsAtTheEnd: true });
  });

  it("preview-cleanup deletes pr-<n> and forgives only a Worker that never existed", () => {
    const run = deployJob("preview-cleanup")?.steps.find((step) => step.name === "delete");
    expect({
      worker: run?.env?.["WORKER"],
      delete: run?.run?.includes('bunx wrangler delete --name "$WORKER" --force'),
      forgiven: run?.run?.match(/code: \d+/g),
      failsOtherwise: run?.run?.includes("exit 1"),
      waits: textOf(deploy, "preview-cleanup").includes("cancel-in-progress: false"),
    }).toEqual({
      worker: "pr-${{ github.event.number }}",
      delete: true,
      forgiven: ["code: 10090"],
      failsOtherwise: true,
      waits: true,
    });
  });
});

const MAIN_JOBS = ["dev", "production"];
const ON_MAIN =
  "github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'";
const COMMIT: Record<string, string> = {
  dev: "${{ github.event.workflow_run.head_sha || github.sha }}",
  production: "${{ github.event.workflow_run.head_sha }}",
};
const ADDRESS: Record<string, string> = {
  dev: "https://matter-of-place-dev.holy-meadow-4327.workers.dev",
  production: "https://matter-of-place.holy-meadow-4327.workers.dev",
};
const PRODUCTION_ON = "vars.PRODUCTION_DEPLOY == 'on'";
const GUARDED = "steps.guard.outputs.superseded != 'true'";
const ROLLBACK_IF = "failure() && steps.deploy.outcome == 'success'";
const DEV_CURRENT = [
  `if out=$(bunx wrangler deployments list --name matter-of-place-dev --json 2>"$RUNNER_TEMP/current.err"); then`,
  `  version=$(printf '%s' "$out" | jq -r 'last | .versions[] | select(.percentage == 100) | .version_id')`,
  `elif grep -q "code: 10007" "$RUNNER_TEMP/current.err"; then`,
  `  version=""`,
  "else",
  `  cat "$RUNNER_TEMP/current.err"`,
  "  exit 1",
  "fi",
  'echo "serving: ${version:-none}"',
  'echo "version=$version" >> "$GITHUB_OUTPUT"',
  "",
].join("\n");
const DEV_ROLLBACK = [
  'if [ -z "$PREVIOUS" ]; then',
  '  echo "first deploy: nothing to roll back to"',
  "  exit 1",
  "fi",
  'bunx wrangler rollback "$PREVIOUS" --name matter-of-place-dev --message "smoke failed $SHA" --yes',
  'echo "rolled back to $PREVIOUS"',
  "",
].join("\n");
const MainTriggers = z.object({
  workflow_run: z.object({
    workflows: z.array(z.string()),
    types: z.array(z.string()),
    branches: z.array(z.string()),
  }),
  workflow_dispatch: z.object({
    inputs: z.object({ rehearse_rollback: z.object({ type: z.string(), default: z.boolean() }) }),
  }),
});
const stepsOf = (job: string) => deployJob(job)?.steps ?? [];

describe("deploy.yml production and dev jobs (step 7)", () => {
  it("dev and production deploy only the commit ci passed on main (6a, 11)", () => {
    const checkout = (job: string) =>
      stepsOf(job).find((step) => step.uses?.startsWith("actions/checkout@"))?.with;
    expect({
      trigger: MainTriggers.parse(deploy?.data.on).workflow_run,
      dev: deployJob("dev")?.if,
      production: deployJob("production")?.if,
      ref: MAIN_JOBS.map((job) => checkout(job)?.["ref"]),
      depth: MAIN_JOBS.map((job) => checkout(job)?.["fetch-depth"]),
      sha: MAIN_JOBS.map((job) => has(job, `SHA: ${COMMIT[job] ?? ""}`)),
      release: MAIN_JOBS.map((job) => has(job, "--var SENTRY_RELEASE:$SHA ")),
    }).toEqual({
      trigger: { workflows: ["ci"], types: ["completed"], branches: ["main"] },
      dev: `(${ON_MAIN}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')`,
      production: `${ON_MAIN} && ${PRODUCTION_ON}`,
      ref: MAIN_JOBS.map((job) => COMMIT[job]),
      depth: [0, 0],
      sha: [true, true],
      release: [true, true],
    });
  });

  it("dev and production run the guard first and every later step waits on it (G24)", () => {
    const loose = MAIN_JOBS.flatMap((job) => {
      const steps = stepsOf(job);
      const first = steps[1];
      const guard =
        first?.id === "guard" && first.run === 'node scripts/deploy-guard.mjs "$SHA"'
          ? []
          : [`${job}: the step after checkout is not the guard`];
      const ungated = steps
        .slice(2)
        .filter((step) => !(step.if?.includes(GUARDED) === true || step.if === ROLLBACK_IF))
        .map((step) => `${job}: ${step.name ?? step.uses ?? step.run ?? ""}`);
      return [...guard, ...ungated];
    });
    expect(loose).toEqual([]);
  });

  it("dev and production wait, smoke their own address, then roll back (G22, P-137)", () => {
    const view = (job: string) => {
      const steps = stepsOf(job);
      const at = (test: (step: (typeof steps)[number]) => boolean) => steps.findIndex(test);
      const deployAt = at((step) => step.id === "deploy");
      const waitAt = at((step) => step.name === "wait");
      const smokeAt = at((step) => step.run === 'node scripts/smoke.mjs "$URL"');
      const wait = steps[waitAt]?.run ?? "";
      const rollback = steps.at(-1);
      return {
        address: has(job, `URL: ${ADDRESS[job] ?? ""}\n`),
        ordered:
          deployAt >= 0 && deployAt < waitAt && waitAt < smokeAt && smokeAt === steps.length - 2,
        waitsForTen:
          wait.includes(`curl -s -o /dev/null -D - "$URL/" | grep -qi '^x-request-id:'`) &&
          /else\s+ok=0\s+fi/.test(wait) &&
          wait.includes('if [ "$ok" -ge 10 ]; then') &&
          wait.trimEnd().endsWith("exit 1"),
        rollbackIf: rollback?.if,
        rollback: rollback?.run,
      };
    };
    const rollbackOf = (worker: string) =>
      `bunx wrangler rollback --name ${worker} --message "smoke failed $SHA" --yes`;
    const smoke = stepsOf("dev").find((step) => step.name === "smoke");
    expect({
      dev: view("dev"),
      production: view("production"),
      rehearsal: smoke?.env?.["SMOKE_FORCE_FAIL"],
      input: MainTriggers.parse(deploy?.data.on).workflow_dispatch.inputs.rehearse_rollback,
    }).toEqual({
      dev: {
        address: true,
        ordered: true,
        waitsForTen: true,
        rollbackIf: ROLLBACK_IF,
        rollback: DEV_ROLLBACK,
      },
      production: {
        address: true,
        ordered: true,
        waitsForTen: true,
        rollbackIf: ROLLBACK_IF,
        rollback: rollbackOf("matter-of-place"),
      },
      rehearsal: "${{ inputs.rehearse_rollback && '1' || '' }}",
      input: { type: "boolean", default: false },
    });
  });

  it("dev rolls back to the version that served before its deploy (H49 (2))", () => {
    const steps = stepsOf("dev");
    const current = steps.findIndex((step) => step.id === "current");
    const rollback = steps.find((step) => step.name === "rollback");
    expect({
      when: steps[current]?.if,
      reads: steps[current]?.run,
      beforeDeploy: current >= 0 && current < steps.findIndex((step) => step.id === "deploy"),
      target: rollback?.env?.["PREVIOUS"],
    }).toEqual({
      when: GUARDED,
      reads: DEV_CURRENT,
      beforeDeploy: true,
      target: "${{ steps.current.outputs.version }}",
    });
  });

  it("production runs only while PRODUCTION_DEPLOY is on, dev always (H49 (1))", () => {
    expect({
      production: String(deployJob("production")?.if).split(" && ").at(-1),
      dev: String(deployJob("dev")?.if).includes("PRODUCTION_DEPLOY"),
    }).toEqual({ production: PRODUCTION_ON, dev: false });
  });

  it("dev pushes main's migrations before its deploy, only when there are any (13)", () => {
    const steps = stepsOf("dev");
    const push = steps.findIndex((step) => step.run?.includes("bun run db:push") === true);
    expect({
      detects: steps
        .find((step) => step.id === "migrations")
        ?.run?.includes("git ls-files 'supabase/migrations/*.sql' | grep -q ."),
      when: steps[push]?.if,
      link: steps[push]?.run?.includes(
        'bunx supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF" --password "$DEV_SUPABASE_DB_PASSWORD"',
      ),
      beforeDeploy: push >= 0 && push < steps.findIndex((step) => step.id === "deploy"),
    }).toEqual({
      detects: true,
      when: `${GUARDED} && steps.migrations.outputs.has_migrations == 'true'`,
      link: true,
      beforeDeploy: true,
    });
  });

  it("only dev deploys the job runner, after db:push, before the Worker (H35 (1))", () => {
    const steps = stepsOf("dev");
    const at = (test: (step: (typeof steps)[number]) => boolean) => steps.findIndex(test);
    const runner = at((step) => step.run?.includes("functions deploy") === true);
    const push = at((step) => step.run?.includes("bun run db:push") === true);
    const elsewhere = Object.entries(deploy?.data.jobs ?? {})
      .filter(([job]) => job !== "dev")
      .filter(([, job]) =>
        job.steps.some((step) => step.run?.includes("functions deploy") === true),
      )
      .map(([job]) => job);
    expect({
      once: (deploy?.text ?? "").split("functions deploy").length - 1,
      when: steps[runner]?.if,
      run: steps[runner]?.run,
      token: steps[runner]?.env?.["SUPABASE_ACCESS_TOKEN"],
      ordered: push >= 0 && push < runner && runner < at((step) => step.id === "deploy"),
      elsewhere,
    }).toEqual({
      once: 1,
      when: GUARDED,
      run: 'bunx supabase functions deploy job-runner --use-api --project-ref "$DEV_SUPABASE_PROJECT_REF"',
      token: "${{ secrets.SUPABASE_ACCESS_TOKEN }}",
      ordered: true,
      elsewhere: [],
    });
  });

  it("dev deploys matter-of-place-dev and switches on HAS_DB (G19, 13a)", () => {
    expect([
      has("dev", "--name matter-of-place-dev"),
      has("dev", MOP_ENV_FLAG),
      has("dev", HAS_DB_ENV),
      has("dev", API_BASE),
      ...["dev", "production"].map((job) => has(job, "--var MEDIA_PUBLIC_BASE:")),
    ]).toEqual(Array<boolean>(6).fill(true));
  });

  it("production needs dev, touches no database and reads only the deploy token (13, 15)", () => {
    const touches = ["db:push", "supabase link", "functions deploy"].filter((word) =>
      has("production", word),
    );
    const secrets = [...textOf(deploy, "production").matchAll(/secrets\.(\w+)/g)].map(
      (match) => match[1],
    );
    expect({
      needsDev: has("production", "needs: dev"),
      touches,
      secrets: [...new Set(secrets)],
    }).toEqual({
      needsDev: true,
      touches: [],
      secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    });
  });

  it("production and dev never read CI_HEAVY (invariant 14)", () => {
    expect(["production", "dev"].filter((job) => has(job, "CI_HEAVY"))).toEqual([]);
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

describe("merge gate (invariant 6b, R55)", () => {
  it("every pull request job of ci.yml, and deploy.yml's preview, is a required check", () => {
    const reachable = Object.entries(ci?.data.jobs ?? {})
      .filter(([, job]) => ci !== undefined && pullRequestReaches(ci, job))
      .map(([name]) => name);
    const jobs = deploy === undefined ? reachable : [...reachable, "preview"];
    expect({
      mergeGateJob: Object.keys(ci?.data.jobs ?? {}).includes("merge-gate"),
      unlisted: jobs.filter((name) => !REQUIRED_PR_CHECKS.includes(name)),
    }).toEqual({ mergeGateJob: true, unlisted: [] });
  });

  it("the merge-gate job runs on push only, with read access to pull requests, checks and statuses", () => {
    const job = ci?.data.jobs["merge-gate"];
    expect({
      condition: job?.if,
      permissions: job?.permissions,
      script: job?.steps.some((step) => step.run === "node scripts/merge-gate.mjs"),
    }).toEqual({
      condition: "github.event_name == 'push'",
      permissions: {
        contents: "read",
        "pull-requests": "read",
        checks: "read",
        statuses: "read",
      },
      script: true,
    });
  });

  it("the gate reads the same job names as the YAML parser, in every workflow", () => {
    expect(workflows.map((w) => [w.file, jobKeys(w.text)])).toEqual(
      workflows.map((w) => [w.file, Object.keys(w.data.jobs)]),
    );
  });
});

describe("the orchestrator's merge script is under the app's gates (H42 (2), G-032)", () => {
  const GATE = "workspace/05-plans/merge-gate.mjs";

  it("tsconfig.scripts.json type-checks it", () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(APP, "tsconfig.scripts.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    const files = (parsed?.fileNames ?? []).map((file) => resolve(file));
    expect(files.includes(resolve(ROOT, GATE))).toBe(true);
  });

  it("lint runs on it from the repository root, and format:check reads .prettierrc for it", () => {
    expect({
      lint: packageJson.scripts["lint"]?.includes(
        `&& cd .. && eslint --config app/eslint.config.js --max-warnings 0 ${GATE}`,
      ),
      formatCheck: packageJson.scripts["format:check"],
    }).toEqual({
      lint: true,
      formatCheck: `prettier --config .prettierrc --check . ../${GATE} ../workspace/audits/tools ../scripts/audit`,
    });
  });

  it("lint gives prettier/prettier the options of .prettierrc for it", async () => {
    const Resolved = z.object({
      rules: z.object({ "prettier/prettier": z.tuple([z.number(), z.record(Value)]) }),
    });
    const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(APP, "eslint.config.js") });
    const resolved = Resolved.parse(await eslint.calculateConfigForFile(GATE));
    expect(resolved.rules["prettier/prettier"]).toEqual([
      2,
      z.record(Value).parse(JSON.parse(read(join(APP, ".prettierrc")))),
    ]);
  }, 20_000);
});

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
      maxWarnings: packageJson.scripts["lint"]?.startsWith("eslint . --max-warnings 0 && "),
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
