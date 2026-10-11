// The checks after the launch switch and before any cut-over (L1 step 1h, G30): one line per check, `ok` or `red` with
// the exact missing thing, exit 1 on any red line. It only reads (ruling H35 (5)): name lists, digests compared here
// and never printed, and selects on the one database through DEV_DB_URL. A missing operator input is red, never
// BLOCKED (G32); the one BLOCKED line is LinkedIn's application approval, which does not change the exit code. Before
// the switch the function, variable and database lines print red `database not production yet`.
// Run it from `app/` in a shell with the dev profile and the admin tokens (CLOUDFLARE_API_TOKEN, SUPABASE_ACCESS_TOKEN).
// `--fixture-dir <dir>` reads the name lists from wrangler.txt (`<worker> <NAME>`), supabase.txt and supabase-dev.txt
// (`<NAME> <sha256>`), gh.txt and gh-vars.txt (the tab-separated `gh secret list` and `gh variable list` output).
// usage: node scripts/launch/preflight.mjs [--fixture-dir <dir>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import pg from "pg";
import { z } from "zod";
import { isProductionEnvironment } from "../lib/assert-not-production.mjs";
import { pgClientConfig } from "../lib/pg-connect.mjs";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = join(APP, "..");
const AUDITS = join(ROOT, "workspace", "audits");
const DAY_MS = 86_400_000;
const NOT_PRODUCTION = "database not production yet";
const WORKER = "matter-of-place";
const DEV_WORKER = "matter-of-place-dev";
// H1's observed exit: the only rows allowed open, each `blocked-on-L1`.
const H1_OPEN = ["H1-03", "H1-25", "H1-30", "H1-35", "H1-41"];
const PROD_WORKER_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TURNSTILE_SECRET",
  "SENTRY_DSN",
  "RATE_LIMIT_SALT",
  "CONFIRM_TOKEN_SECRET",
  "RESEND_WEBHOOK_SECRET",
  "PREVIEW_TOKEN_SECRET",
  "CSRF_SECRET",
  "RENDER_CALLBACK_SECRET",
  "JOB_RUNNER_SECRET",
  "OPS_HEALTH_TOKEN",
];
const PROD_FUNCTION_SECRETS = [
  "JOB_RUNNER_SECRET",
  "MOP_ENV",
  "SENTRY_DSN",
  "RENDER_CALLBACK_URL",
  "GITHUB_DISPATCH_TOKEN",
  "GITHUB_REPO",
  "CONFIRM_TOKEN_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_FROM_BULK",
  "ADMIN_NOTIFY_EMAIL",
  "SITE_URL",
  "CF_PURGE_TOKEN",
  "CF_ZONE_ID",
  "MEDIA_PUBLIC_BASE",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_PAGE_TOKEN",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "X_ACCESS_TOKEN",
  "X_REFRESH_TOKEN",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
];
const LINKEDIN_TOKENS = ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_REFRESH_TOKEN"];
// Switches of the preview stage only: after the switch MOP_ENV=production already makes side effects live (E2E-04).
const STAGE_SWITCHES = ["SOCIAL_DRY_RUN", "SOCIAL_LIVE", "EMAIL_DRY_RUN", "EMAIL_LIVE"];
const OMNIKOM = ["OMNIKOM_WEBHOOK_URL", "OMNIKOM_WEBHOOK_SECRET"];
const GH_SECRETS = [
  "DEV_SUPABASE_PROJECT_REF",
  "DEV_SUPABASE_DB_PASSWORD",
  "DEV_SUPABASE_SERVICE_ROLE_KEY",
  "RENDER_CALLBACK_SECRET",
  "PREVIEW_WORKER_SECRETS_JSON",
];
// DO-02 and ruling H5 (no backup passphrase), H35 (1) (no second database), H33 (2) (no R2).
const GH_FORBIDDEN_PREFIXES = ["BACKUP_", "PROD_SUPABASE_", "R2_"];
const GH_FORBIDDEN_VARIABLES = ["MOP_LAUNCHED", "DEV_MEDIA_BASE_URL", "PROD_MEDIA_BASE_URL"];
// One catalog change is one edit here (B2 reference seed, B8b automation_seed).
const EXPECTED_COUNTS = {
  regions: 12,
  decline_reasons: 6,
  automation_recipes: 18,
  channel_settings: 6,
  schedule_settings: 8,
};

/** @typedef {{ name: string, sql: string, expect: string }} DbCheck */

/** Database lines: each select prints one value, compared as text. */
/** @type {DbCheck[]} */
const DB_CHECKS = [
  {
    name: "illustrative content",
    sql: "select public_state()->>'illustrative_content'",
    expect: "false",
  },
  {
    name: "markets coming soon",
    sql: "select count(*) from markets where coming_soon",
    expect: "3",
  },
  { name: "markets", sql: "select count(*) from markets", expect: "3" },
  {
    name: "coming_soon_global",
    sql: "select value #>> '{}' from settings where key = 'coming_soon_global'",
    expect: "false",
  },
  ...Object.entries(EXPECTED_COUNTS).map(([table, count]) => ({
    name: table,
    sql: `select count(*) from ${table}`,
    expect: String(count),
  })),
  { name: "properties", sql: "select count(*) from properties", expect: "0" },
  { name: "agent keys", sql: "select count(*) from agent_keys", expect: "0" },
  {
    name: "admin users",
    sql: "select (count(*) >= 1)::text from user_roles where role = 'admin'",
    expect: "true",
  },
  {
    name: "vault job runner",
    sql: "select count(*) from vault.secrets where name in ('job_runner_url','job_runner_secret')",
    expect: "2",
  },
  // B8's `beat('runner', ...)` row, never a cron.job_run_details row, which says succeeded on a 401 (DO-03, H9).
  {
    name: "runner heartbeat",
    sql: "select coalesce(bool_or(now() - at < interval '3 minutes'), false)::text from ops_heartbeats where name = 'runner'",
    expect: "true",
  },
  {
    name: "email caps",
    sql: "select concat_ws('|', value->>'daily_cap', value->>'bulk_cap', value->>'monthly_cap', jsonb_array_length(value->'dev_recipients')) from settings where key = 'email'",
    expect: "75|50|2600|0",
  },
  {
    name: "cron history retention",
    sql: "select keep_for::text from retention_policies where key = 'cron_history'",
    expect: "7 days",
  },
  {
    name: "schedules enabled",
    sql: "select count(*) from schedule_settings where enabled and key in ('keepwarm','prune','reconcile','kpi_weekly','newsletter_hygiene')",
    expect: "5",
  },
];

const wranglerList = z.array(z.object({ name: z.string() }));
const secretsList = z.object({
  secrets: z.array(z.object({ name: z.string(), value: z.string() })),
});
const migrationList = z.object({
  migrations: z.array(z.object({ local: z.string(), remote: z.string() })),
});
const templateKeys = z.array(z.string());

/** @type {string[]} */
const red = [];

/**
 * @param {string} name
 * @param {boolean} passed
 * @param {string} observed
 */
function line(name, passed, observed) {
  process.stdout.write(`${passed ? "ok " : "red"}  ${name}: ${observed}\n`);
  if (!passed) red.push(name);
}

/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Standard output of a command run from the app folder, or an Error naming what failed.
 * @param {string} command
 * @param {string[]} args
 * @returns {string | Error}
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: APP, encoding: "utf8", maxBuffer: 1 << 24 });
  if (result.error !== undefined) return result.error;
  if (result.status !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1) ?? "";
    return new Error(
      `${command} ${args.slice(0, 3).join(" ")} exited ${String(result.status)} ${reason}`,
    );
  }
  return result.stdout;
}

/**
 * The words of each non-empty line of a name list, split on white space.
 * @param {string} text
 * @returns {string[][]}
 */
const rows = (text) =>
  text
    .split(/\r?\n/)
    .map((row) => row.trim().split(/\s+/))
    .filter((words) => words[0] !== undefined && words[0] !== "");

/**
 * @param {string} text
 * @returns {Map<string, string>} name to the second word (a digest or a value)
 */
const pairs = (text) => new Map(rows(text).map(([name = "", value = ""]) => [name, value]));

/**
 * The lists the checks read, from the CLIs or from a fixture folder.
 * @param {string | undefined} dir
 */
function lists(dir) {
  /** @param {string} file */
  const fixture = (file) => (dir === undefined ? undefined : readFileSync(join(dir, file), "utf8"));
  /** @param {string} worker */
  const worker = (worker) => {
    const out = run("bunx", ["wrangler", "secret", "list", "--name", worker]);
    return out instanceof Error
      ? out
      : wranglerList
          .parse(JSON.parse(out))
          .map((secret) => `${worker} ${secret.name}`)
          .join("\n");
  };
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
  return {
    /** @returns {string | Error} */
    wrangler: () => {
      const recorded = fixture("wrangler.txt");
      if (recorded !== undefined) return recorded;
      const both = [worker(WORKER), worker(DEV_WORKER)];
      return both.find((out) => out instanceof Error) ?? both.join("\n");
    },
    /** @returns {string | Error} */
    functions: () => {
      const recorded = fixture("supabase.txt");
      if (recorded !== undefined) return recorded;
      const out = run("bunx", [
        "supabase",
        "secrets",
        "list",
        "--project-ref",
        ref,
        "--output-format",
        "json",
        "--agent",
        "no",
      ]);
      return out instanceof Error
        ? out
        : secretsList
            .parse(JSON.parse(out))
            .secrets.map((secret) => `${secret.name} ${secret.value}`)
            .join("\n");
    },
    /** @returns {string | Error} */
    ghSecrets: () => fixture("gh.txt") ?? run("gh", ["secret", "list"]),
    /** @returns {string | Error} */
    ghVariables: () => fixture("gh-vars.txt") ?? run("gh", ["variable", "list"]),
    /** The digests check 7 compares: recorded, or computed here from `.env` and `.env.ops`. */
    resendDigests: () => {
      const recorded = fixture("supabase-dev.txt");
      if (recorded !== undefined) return pairs(recorded);
      /** @type {Map<string, string>} */
      const digests = new Map();
      /** @type {[string, string[]][]} */
      const sources = [
        [".env", ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"]],
        [".env.ops", ["PROD_RESEND_API_KEY", "PROD_RESEND_WEBHOOK_SECRET"]],
      ];
      for (const [file, names] of sources) {
        const path = join(ROOT, file);
        const values = existsSync(path)
          ? parseEnv(readFileSync(path, "utf8").replaceAll("\r", ""))
          : {};
        for (const name of names) {
          const value = values[name];
          if (value !== undefined && value !== "") digests.set(name, sha256(value));
        }
      }
      return digests;
    },
  };
}

/** (1) H1 green: the newest report is under 7 days old, with no fail or blocked row and only the allowed open rows. */
function checkHarden() {
  const reports = existsSync(AUDITS)
    ? readdirSync(AUDITS)
        .filter((file) => /^harden-\d{4}-\d{2}-\d{2}\.md$/.test(file))
        .sort()
    : [];
  const newest = reports.at(-1);
  if (newest === undefined) {
    line("1 H1 report", false, "no workspace/audits/harden-*.md");
    return;
  }
  const days = (Date.now() - Date.parse(newest.slice(7, 17))) / DAY_MS;
  const results = rows(readFileSync(join(AUDITS, newest), "utf8"))
    .filter(([cell, id]) => cell === "|" && /^H1-\d+$/.test(id ?? ""))
    .map((words) => {
      const cells = words
        .join(" ")
        .split("|")
        .map((cell) => cell.trim());
      return { id: cells[1] ?? "", result: cells[3] ?? "" };
    });
  const faults = [
    ...(days < 7 ? [] : [`${newest} is ${String(Math.floor(days))} days old`]),
    ...results
      .filter(({ id, result }) => {
        if (result === "pass" || result === "signed") return false;
        return !(result === "blocked-on-L1" && H1_OPEN.includes(id));
      })
      .map(({ id, result }) => `${id} ${result}`),
  ];
  line(
    "1 H1 report",
    results.length > 0 && faults.length === 0,
    results.length === 0
      ? `${newest} has no H1 row`
      : faults.length === 0
        ? `${newest}, ${String(results.length)} rows`
        : faults.join(", "),
  );
}

/** @param {string | Error} text */
function names(text) {
  return text instanceof Error ? text : rows(text);
}

/** (2) Worker secret names. @param {string | Error} listed */
function checkWorkers(listed) {
  const words = names(listed);
  if (words instanceof Error) {
    line("2 worker secrets", false, words.message);
    return;
  }
  /** @param {string} worker */
  const of = (worker) => words.filter(([on]) => on === worker).map(([, name]) => name ?? "");
  const prod = of(WORKER);
  const missing = PROD_WORKER_SECRETS.filter((name) => !prod.includes(name));
  line(
    `2 ${WORKER} secrets`,
    missing.length === 0,
    missing.length === 0
      ? `${String(PROD_WORKER_SECRETS.length)} present`
      : `${missing.join(", ")} missing`,
  );
  // RESEND_API_KEY is a function secret, never a Worker secret (B5 invariant 10); the Sentry test token is for a test.
  for (const name of ["RESEND_API_KEY", "SENTRY_TEST_TOKEN"]) {
    line(
      `2 ${WORKER} without ${name}`,
      !prod.includes(name),
      prod.includes(name) ? "present" : "absent",
    );
  }
  const dev = of(DEV_WORKER);
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    line(
      `2 ${DEV_WORKER} without ${name}`,
      !dev.includes(name),
      dev.includes(name) ? `${name} still on ${DEV_WORKER}` : "absent",
    );
  }
}

/** (3) Function secrets of the one project. @param {string | Error} listed */
function checkFunctions(listed) {
  if (listed instanceof Error) {
    line("3 function secrets", false, listed.message);
    return;
  }
  const digests = pairs(listed);
  const missing = PROD_FUNCTION_SECRETS.filter((name) => !digests.has(name));
  line(
    "3 function secrets",
    missing.length === 0,
    missing.length === 0
      ? `${String(PROD_FUNCTION_SECRETS.length)} present`
      : `${missing.join(", ")} missing`,
  );
  const stage = digests.get("MOP_ENV");
  line(
    "3 MOP_ENV",
    stage === sha256("production"),
    stage === undefined
      ? "missing"
      : stage === sha256("production")
        ? "production"
        : "not production",
  );
  const linkedin = LINKEDIN_TOKENS.filter((name) => !digests.has(name));
  process.stdout.write(
    linkedin.length === 0
      ? "ok   3 linkedin tokens: present\n"
      : `BLOCKED linkedin application pending: ${linkedin.join(", ")} absent\n`,
  );
  for (const name of STAGE_SWITCHES) {
    line(`3 ${name} absent`, !digests.has(name), digests.has(name) ? `${name} present` : "absent");
  }
  const omnikom = OMNIKOM.filter((name) => digests.has(name)).length;
  process.stdout.write(
    omnikom === OMNIKOM.length
      ? "ok   3 omnikom: configured\n"
      : "ok   3 omnikom: switched off (S59)\n",
  );
}

/** (4) GitHub secret names. @param {string | Error} listed */
function checkGhSecrets(listed) {
  const words = names(listed);
  if (words instanceof Error) {
    line("4 github secrets", false, words.message);
    return;
  }
  const present = words.map(([name]) => name ?? "");
  const missing = GH_SECRETS.filter((name) => !present.includes(name));
  line(
    "4 github secrets",
    missing.length === 0,
    missing.length === 0 ? `${String(GH_SECRETS.length)} present` : `${missing.join(", ")} missing`,
  );
  const forbidden = present.filter((name) =>
    GH_FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  line(
    "4 github secrets forbidden",
    forbidden.length === 0,
    forbidden.length === 0
      ? `no ${GH_FORBIDDEN_PREFIXES.join(" ")} name`
      : forbidden.map((name) => `${name} present`).join(", "),
  );
}

/** (4) GitHub variables. @param {string | Error} listed */
function checkGhVariables(listed) {
  const words = names(listed);
  if (words instanceof Error) {
    line("4 github variables", false, words.message);
    return;
  }
  const values = new Map(words.map(([name = "", value = ""]) => [name, value]));
  line(
    "4 MOP_DB_PRODUCTION",
    values.get("MOP_DB_PRODUCTION") === "true",
    `is ${values.get("MOP_DB_PRODUCTION") ?? "absent"}`,
  );
  for (const name of GH_FORBIDDEN_VARIABLES) {
    line(`4 ${name} absent`, !values.has(name), values.has(name) ? `${name} present` : "absent");
  }
}

/**
 * (5) The database, read through DEV_DB_URL. The environment line comes first; the rest run only in production.
 * @param {pg.Client} client
 * @param {boolean} production
 * @param {string} environment
 */
async function checkDatabase(client, production, environment) {
  line(
    "5 environment",
    production,
    production ? "production" : `${environment}, ${NOT_PRODUCTION}`,
  );
  if (!production) return;
  const migrations = run("bunx", [
    "supabase",
    "migration",
    "list",
    "--linked",
    "--output-format",
    "json",
    "--agent",
    "no",
  ]);
  if (migrations instanceof Error) line("5 migrations", false, migrations.message);
  else {
    const localOnly = migrationList
      .parse(JSON.parse(migrations))
      .migrations.filter((row) => row.remote === "")
      .map((row) => row.local);
    line(
      "5 migrations",
      localOnly.length === 0,
      localOnly.length === 0 ? "none only local" : `only local ${localOnly.join(", ")}`,
    );
  }
  for (const check of DB_CHECKS) {
    /** @type {import("pg").QueryArrayResult<unknown[]>} */
    const result = await client.query({ text: check.sql, rowMode: "array" });
    const cell = result.rows[0]?.[0];
    const value = typeof cell === "string" ? cell : "no row";
    line(
      `5 ${check.name}`,
      value === check.expect,
      value === check.expect ? value : `${value}, expected ${check.expect}`,
    );
  }
  // The `.ts` list is not importable from a `.mjs` run by node, so bun prints it.
  const printed = run("bun", [
    "-e",
    "import { emailTemplateKeys } from './src/domain/email.ts'; console.log(JSON.stringify(emailTemplateKeys))",
  ]);
  if (printed instanceof Error) {
    line("5 email templates", false, printed.message);
    return;
  }
  const wanted = templateKeys.parse(JSON.parse(printed));
  /** @type {import("pg").QueryResult<{ key: string }>} */
  const stored = await client.query("select key from email_templates order by key");
  const have = stored.rows.map((row) => row.key);
  const faults = [
    ...wanted.filter((key) => !have.includes(key)).map((key) => `${key} missing`),
    ...have.filter((key) => !wanted.includes(key)).map((key) => `${key} extra`),
  ];
  line(
    "5 email templates",
    faults.length === 0,
    faults.length === 0 ? "equal to emailTemplateKeys" : faults.join(", "),
  );
}

/** (6) No production stub but `post-v1` (CS-11). */
function checkStubs() {
  const counted = run("bun", ["run", "scripts/stubs.ts", "--count-non-v1"]);
  if (counted instanceof Error) {
    line("6 stubs", false, counted.message);
    return;
  }
  if (counted.trim() === "0") {
    line("6 stubs", true, "0 markers other than post-v1");
    return;
  }
  const listed = spawnSync("bun", ["run", "scripts/stubs.ts"], {
    cwd: APP,
    encoding: "utf8",
  }).stdout;
  const files = listed
    .split("\n")
    .filter((row) => / STUB\(/.test(row) && !row.includes("STUB(post-v1)"))
    .map((row) => row.split(" ")[0] ?? "");
  line("6 stubs", false, `${counted.trim()} markers: ${files.join(", ")}`);
}

/**
 * (7) One Resend credential per stage (INT-02 (4), ruling H35 (8)). Digests are compared, never printed.
 * @param {string | Error} listed
 * @param {Map<string, string>} digests
 */
function checkResend(listed, digests) {
  if (listed instanceof Error) {
    line("7 resend key", false, listed.message);
    return;
  }
  const project = pairs(listed).get("RESEND_API_KEY");
  const prod = digests.get("PROD_RESEND_API_KEY");
  const build = digests.get("RESEND_API_KEY");
  line(
    "7 resend key",
    project !== undefined && project === prod && project !== build,
    project === undefined
      ? "RESEND_API_KEY not set on the project"
      : prod === undefined
        ? "PROD_RESEND_API_KEY missing in .env.ops"
        : project === build
          ? "the project holds the build-stage key"
          : project === prod
            ? "the production key"
            : "the project key is not PROD_RESEND_API_KEY",
  );
  const devHook = digests.get("RESEND_WEBHOOK_SECRET");
  const prodHook = digests.get("PROD_RESEND_WEBHOOK_SECRET");
  line(
    "7 resend webhook secrets",
    devHook !== undefined && prodHook !== undefined && devHook !== prodHook,
    prodHook === undefined
      ? "PROD_RESEND_WEBHOOK_SECRET missing in .env.ops"
      : devHook === undefined
        ? "RESEND_WEBHOOK_SECRET missing in .env"
        : devHook === prodHook
          ? "the dev and production webhook secrets are equal"
          : "different",
  );
}

/**
 * The stage in `settings.environment`, or the reason it could not be read.
 * @param {pg.Client} client
 */
async function readEnvironment(client) {
  /** @type {import("pg").QueryResult<{ value: string | null }>} */
  const result = await client.query(
    "select value #>> '{}' as value from settings where key = 'environment'",
  );
  return result.rows[0]?.value ?? "no environment row";
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { "fixture-dir": { type: "string" } } });
  const dir = values["fixture-dir"];
  const source = lists(dir);
  const client = new pg.Client(pgClientConfig(process.env["DEV_DB_URL"]));
  await client.connect();
  try {
    const environment = await readEnvironment(client);
    const production = isProductionEnvironment(environment);
    // A fixture is a recorded post-switch state, so its lists are judged whatever the stage.
    const judgeStage = production || dir !== undefined;
    checkHarden();
    checkWorkers(source.wrangler());
    const functions = source.functions();
    if (judgeStage) checkFunctions(functions);
    else line("3 function secrets", false, NOT_PRODUCTION);
    checkGhSecrets(source.ghSecrets());
    if (judgeStage) checkGhVariables(source.ghVariables());
    else line("4 github variables", false, NOT_PRODUCTION);
    await checkDatabase(client, production, environment);
    checkStubs();
    checkResend(functions, source.resendDigests());
  } finally {
    await client.end();
  }
  process.stdout.write(
    red.length === 0 ? "preflight: ok\n" : `preflight: red ${String(red.length)} lines\n`,
  );
  return red.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
