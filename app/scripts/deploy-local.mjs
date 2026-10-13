// `bun --env-file=<the project .env> scripts/deploy-local.mjs --sha <40 hex>`, run from `app/` of a clean worktree at the
// tip of origin/main (ruling H103). While GitHub Actions starts no job on the private repo (GOTCHAS P-3456), this is the
// `dev` job's database half and the `production` job of deploy.yml on the laptop, in their order, with two steps
// first that Jay asked for: a fresh backup, and every pending migration rehearsed inside a transaction that is rolled
// back on the live database. A failed step stops the run; a failure after the Worker deploy rolls the Worker back.
// The log goes to workspace/05-plans/logs/deploy-local/<sha7>.md; its path is the last line printed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const REPO = "AbdulrahmanAmer/matter-of-place";
const URL_PROD = "https://matter-of-place.holy-meadow-4327.workers.dev";
const TAIL = 25;
const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = resolve(APP, "..");
const LOG_DIR = "workspace/05-plans/logs/deploy-local";

/**
 * The migrations on disk that the database has not recorded, oldest first.
 * @param {string[]} files
 * @param {string[]} applied
 * @returns {string[]}
 */
export function pendingMigrations(files, applied) {
  const done = new Set(applied);
  return files
    .filter((name) => {
      const version = /^(\d{14})_.+\.sql$/.exec(name)?.[1];
      return version !== undefined && !done.has(version);
    })
    .sort();
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: string }} [options]
 */
function sh(command, args, options = {}) {
  // The shell's Supabase pair belongs to another business on this laptop; the project's own names come from --env-file.
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, ...options.env };
  delete env["SUPABASE_URL"];
  delete env["SUPABASE_SERVICE_ROLE_KEY"];
  const result = spawnSync(command, args, {
    cwd: APP,
    env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
  return { ok: result.status === 0 && result.error === undefined, status: result.status, out };
}

const need = (/** @type {string} */ name) => {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set: run with bun --env-file`);
  return value;
};
const variable = (/** @type {string} */ name) =>
  sh("gh", ["variable", "get", name, "-R", REPO]).out.trim();

/** @param {string[]} argv */
function main(argv) {
  const at = argv.indexOf("--sha");
  const sha = at >= 0 ? (argv[at + 1] ?? "") : "";
  if (!/^[0-9a-f]{40}$/.test(sha) || argv.length !== 2) {
    console.error("usage: bun --env-file=<.env> scripts/deploy-local.mjs --sha <40 hex>");
    return 2;
  }
  const dbUrl = need("DEV_DB_URL");
  const ref = need("DEV_SUPABASE_PROJECT_REF");
  need("SUPABASE_ACCESS_TOKEN");
  need("CLOUDFLARE_API_TOKEN");
  need("CLOUDFLARE_ACCOUNT_ID");

  const lines = [`# Local deploy of ${sha} (ruling H103)`, ""];
  const state = { deployed: false };
  /** @param {string} name @param {{ ok: boolean, out: string }} result @param {string} [detail] */
  const record = (name, result, detail = "") => {
    lines.push(`- step ${name}: ${result.ok ? "pass" : "fail"}${detail ? ` (${detail})` : ""}`);
    console.log(lines.at(-1));
    if (!result.ok) lines.push("", "```", ...result.out.trimEnd().split("\n").slice(-TAIL), "```");
    return result.ok;
  };

  const steps = [
    () => {
      sh("git", ["fetch", "--quiet", "origin", "main"]);
      const head = sh("git", ["rev-parse", "HEAD"]).out.trim();
      const tip = sh("git", ["rev-parse", "origin/main"]).out.trim();
      const clean = sh("git", ["status", "--porcelain"]).out.trim() === "";
      const ok = head === sha && tip === sha && clean;
      return record(
        "guard",
        { ok, out: `head ${head}, origin/main ${tip}, clean ${String(clean)}` },
        ok ? "" : "not the clean tip of main",
      );
    },
    () =>
      record(
        "backup",
        sh("bun", [join(homedir(), ".mop-workforce", "backup-local.mjs"), "--manual"]),
      ),
    () => record("install", sh("bun", ["install", "--frozen-lockfile"])),
    () => {
      const applied = sh("psql", [
        dbUrl,
        "-Atc",
        "select version from supabase_migrations.schema_migrations",
      ]);
      if (!applied.ok) return record("rehearse", applied);
      const pending = pendingMigrations(
        readdirSync(join(APP, "supabase/migrations")),
        applied.out.split(/\r?\n/),
      );
      for (const name of pending) {
        const text = readFileSync(join(APP, "supabase/migrations", name), "utf8");
        const run = sh("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
          input: `begin;\n${text}\nrollback;\n`,
        });
        if (!record(`rehearse ${name}`, run, "rolled back")) return false;
      }
      lines.push(`- pending migrations: ${pending.length === 0 ? "none" : pending.join(", ")}`);
      return true;
    },
    () => {
      const link = sh("bunx", [
        "supabase",
        "link",
        "--project-ref",
        ref,
        "--password",
        need("DEV_SUPABASE_DB_PASSWORD"),
      ]);
      if (!record("link", { ok: link.ok, out: link.ok ? "" : "supabase link failed" }))
        return false;
      return record("db-push", sh("bun", ["run", "db:push"]));
    },
    () =>
      record(
        "functions-deploy",
        sh("bunx", [
          "supabase",
          "functions",
          "deploy",
          "job-runner",
          "--use-api",
          "--project-ref",
          ref,
        ]),
      ),
    () =>
      record(
        "build",
        sh("bun", ["run", "build"], {
          env: {
            VITE_SITE_URL: variable("VITE_SITE_URL"),
            VITE_API_BASE_URL: variable("VITE_API_BASE_URL"),
            VITE_TURNSTILE_SITE_KEY: variable("VITE_TURNSTILE_SITE_KEY"),
            VITE_GA4_MEASUREMENT_ID: variable("VITE_GA4_MEASUREMENT_ID"),
          },
        }),
      ),
    () => {
      const media =
        variable("MOP_LAUNCHED") === "true"
          ? "https://matterofplace.com/media"
          : `${URL_PROD}/media`;
      state.deployed = record(
        "deploy",
        sh("bunx", [
          "wrangler",
          "deploy",
          "--config",
          ".output/server/wrangler.json",
          "--var",
          `SENTRY_RELEASE:${sha}`,
          "--var",
          `MEDIA_PUBLIC_BASE:${media}`,
        ]),
      );
      return state.deployed;
    },
    () => {
      let inRow = 0;
      for (let i = 1; i <= 90 && inRow < 10; i += 1) {
        const head = sh("curl", ["-s", "-o", "NUL", "-D", "-", "-m", "10", `${URL_PROD}/`]).out;
        inRow = /^x-request-id:/im.test(head) ? inRow + 1 : 0;
        if (inRow < 10) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      }
      return record("wait", {
        ok: inRow >= 10,
        out: "the Worker did not answer ten times in a row",
      });
    },
    () => record("smoke", sh("node", ["scripts/smoke.mjs", URL_PROD])),
    () => {
      if (variable("MOP_DB_PRODUCTION") !== "true") return true;
      const after = variable("MOP_LAUNCHED") === "true" ? ["--after-launch"] : [];
      return record(
        "assert-coming-soon",
        sh("node", ["scripts/assert-coming-soon.mjs", URL_PROD, ...after]),
      );
    },
  ];

  let ok = true;
  for (const step of steps) {
    if (!step()) {
      ok = false;
      break;
    }
  }
  if (!ok && state.deployed) {
    record(
      "rollback",
      sh("bunx", [
        "wrangler",
        "rollback",
        "--name",
        "matter-of-place",
        "--message",
        `smoke failed ${sha}`,
        "--yes",
      ]),
    );
  }
  lines.push(
    "",
    "Not run: the dev Worker deploy (matter-of-place-dev), which only the preview flow reads.",
    "",
  );
  mkdirSync(join(ROOT, LOG_DIR), { recursive: true });
  const path = join(ROOT, LOG_DIR, `${sha.slice(0, 7)}.md`);
  writeFileSync(path, lines.join("\n"));
  console.log(path);
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
