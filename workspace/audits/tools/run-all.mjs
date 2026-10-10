import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as bing from "./bing.mjs";
import * as cache from "./cache.mjs";
import {
  REPO_ROOT,
  field,
  getJson,
  isMain,
  makeContext,
  messageOf,
  parseJsonOrNull,
} from "./common.mjs";
import * as crawl from "./crawl.mjs";
import * as ga4 from "./ga4.mjs";
import * as gsc from "./gsc.mjs";
import * as kpis from "./kpis.mjs";
import * as notfound from "./notfound.mjs";
import * as psi from "./psi.mjs";
import * as security from "./security.mjs";
import * as uptime from "./uptime.mjs";
import * as usage from "./usage.mjs";

export const REQUIRED = [
  "AUDIT_AGENT_KEY",
  "SITE_URL",
  "PSI_API_KEY",
  "GOOGLE_SA_JSON_B64",
  "GA4_PROPERTY_ID",
  "CF_ANALYTICS_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_ZONE_ID",
  "UPTIME_API_KEY",
];
export const OPTIONAL = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "BING_WEBMASTER_API_KEY"];

/** Names whose value is a secret: `lint-report.mjs` refuses any of them found in a report or a sidecar. */
export const SECRET_NAMES = [
  "AUDIT_AGENT_KEY",
  "AUDIT_AGENT_KEY_DEV",
  "PSI_API_KEY",
  "GOOGLE_SA_JSON_B64",
  "CF_ANALYTICS_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "UPTIME_API_KEY",
  "BING_WEBMASTER_API_KEY",
  "OPS_HEALTH_TOKEN",
];

/**
 * A collector module reduced to what the runner needs. `vendor` collectors read outside hosts with
 * tokens that exist only in the routine or on the laptop; `--from-data` takes their numbers from a
 * data branch instead.
 * @typedef {{
 *   name: string,
 *   keys: string[],
 *   vendor: boolean,
 *   collect: (ctx: import("./common.mjs").Context) => Promise<import("./common.mjs").Collected>,
 * }} CollectorEntry
 * @type {CollectorEntry[]}
 */
export const COLLECTORS = [
  { name: "psi", keys: ["psi"], vendor: true, collect: psi.collect },
  { name: "gsc", keys: ["gsc", "keywords"], vendor: true, collect: gsc.collect },
  { name: "ga4", keys: ["ga4"], vendor: true, collect: ga4.collect },
  { name: "bing", keys: ["bing"], vendor: true, collect: bing.collect },
  { name: "uptime", keys: ["uptime"], vendor: true, collect: uptime.collect },
  { name: "usage", keys: ["usage"], vendor: true, collect: usage.collect },
  { name: "ours", keys: ["usage_ours"], vendor: false, collect: usage.collectOurs },
  {
    name: "notfound",
    keys: ["not_found"],
    vendor: false,
    collect: (ctx) => notfound.collect(ctx),
  },
  {
    name: "kpis",
    keys: ["kpis"],
    vendor: false,
    collect: (ctx) => kpis.collect(ctx),
  },
  { name: "crawl", keys: ["seo", "aeo"], vendor: false, collect: crawl.collect },
  { name: "cache", keys: ["cache"], vendor: false, collect: cache.collect },
  { name: "security", keys: ["security"], vendor: false, collect: security.collect },
];

const SCHEDULE_PATH = "/api/admin/automation/schedule-settings/audit";
const RECORD_RUN_PATH = "/api/admin/audit/record-run";
const DATA_DIR = "workspace/audits/data";

/**
 * @typedef {{
 *   argv: string[],
 *   ctx: import("./common.mjs").Context,
 *   collectors?: CollectorEntry[],
 *   root?: string,
 *   log?: (line: string) => void,
 *   git?: (args: string[]) => string,
 * }} RunOptions
 */

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @returns {boolean}
 */
const isSet = (env, name) => (env[name] ?? "") !== "";

/**
 * @param {string[]} argv
 * @returns {{ checkCredentials: boolean, manual: boolean, collectOnly: boolean, fromData: string | undefined }}
 */
function parseFlags(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "check-credentials": { type: "boolean" },
      manual: { type: "boolean" },
      "collect-only": { type: "boolean" },
      "from-data": { type: "string" },
    },
  });
  return {
    checkCredentials: values["check-credentials"] === true,
    manual: values.manual === true,
    collectOnly: values["collect-only"] === true,
    fromData: values["from-data"],
  };
}

/**
 * The agent key's request to our own admin API.
 * @param {import("./common.mjs").Context} ctx
 * @param {string} path
 * @param {"GET" | "POST"} method
 */
function agentRequest(ctx, path, method) {
  const key = ctx.env["AUDIT_AGENT_KEY"] ?? "";
  return getJson(ctx.fetchImpl, `${ctx.siteUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

/**
 * The `audit` row of `schedule_settings`, read first. `enabled` is true, false, or unknown with the
 * reason: a failed read never stops the run, the routine's own trigger is the second switch.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<{ enabled: boolean } | { reason: string }>}
 */
async function readSchedule(ctx) {
  if (!isSet(ctx.env, "AUDIT_AGENT_KEY") || ctx.siteUrl === "") {
    return { reason: "AUDIT_AGENT_KEY or SITE_URL unset" };
  }
  const answer = await agentRequest(ctx, SCHEDULE_PATH, "GET");
  const enabled = field(answer.json, "enabled");
  return answer.status === 200 && typeof enabled === "boolean"
    ? { enabled }
    : { reason: `schedule read ${answer.reason}` };
}

/**
 * The newest sidecar before `date`, as a repository-relative path.
 * @param {string} root
 * @param {string} date
 * @returns {string | null}
 */
function previousSidecar(root, date) {
  let names;
  try {
    names = readdirSync(resolve(root, DATA_DIR));
  } catch {
    return null;
  }
  const older = names.filter(
    (name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name < `${date}.json`,
  );
  const last = older.sort().at(-1);
  return last === undefined ? null : `${DATA_DIR}/${last}`;
}

/**
 * `--from-data <branch>`: the vendor numbers of a sidecar another job committed.
 * @param {(args: string[]) => string} git
 * @param {string} branch
 * @param {string} date
 * @returns {{ data: unknown } | { reason: string }}
 */
function readDataBranch(git, branch, date) {
  try {
    git(["fetch", "origin", branch]);
    const text = git(["show", `origin/${branch}:${DATA_DIR}/${date}.json`]);
    const data = parseJsonOrNull(text);
    return data === null ? { reason: `${branch} holds no readable ${date}.json` } : { data };
  } catch (error) {
    return { reason: `${branch}: ${messageOf(error)}` };
  }
}

/**
 * @param {RunOptions} options
 * @returns {Promise<number>} the exit code
 */
export async function runAll(options) {
  const { ctx } = options;
  const collectors = options.collectors ?? COLLECTORS;
  const root = options.root ?? REPO_ROOT;
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const git = options.git ?? ((args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }));

  let flags;
  try {
    flags = parseFlags(options.argv);
  } catch (error) {
    log(messageOf(error));
    return 2;
  }

  if (flags.checkCredentials) {
    for (const name of [...REQUIRED, ...OPTIONAL]) {
      log(`${name}: ${isSet(ctx.env, name) ? "ok" : "missing"}`);
    }
    return REQUIRED.some((name) => !isSet(ctx.env, name)) ? 1 : 0;
  }

  const date = ctx.now().toISOString().slice(0, 10);
  /** @type {Record<string, import("./common.mjs").Json>} */
  const sidecar = {};
  /** @type {Record<string, string>} */
  const notMeasured = {};

  if (!flags.manual) {
    const schedule = await readSchedule(ctx);
    if ("enabled" in schedule && !schedule.enabled) {
      log("skipped, disabled");
      return 0;
    }
    if ("reason" in schedule) notMeasured["schedule"] = schedule.reason;
  }

  /** @type {Record<string, unknown>} */
  let fromData = {};
  if (flags.fromData !== undefined) {
    const found = readDataBranch(git, flags.fromData, date);
    if ("reason" in found) notMeasured["from_data"] = found.reason;
    else if (typeof found.data === "object" && found.data !== null) fromData = { ...found.data };
  }
  const takenFromData = flags.fromData !== undefined && !("from_data" in notMeasured);

  for (const entry of collectors) {
    if (takenFromData && entry.vendor) {
      const missed = field(fromData, "not_measured");
      for (const key of entry.keys) {
        const value = fromData[key];
        const reason = field(missed, key);
        if (value !== undefined) sidecar[key] = /** @type {import("./common.mjs").Json} */ (value);
        else
          notMeasured[key] =
            typeof reason === "string" ? reason : `${key} absent from ${flags.fromData ?? ""}`;
      }
      continue;
    }
    /** @type {import("./common.mjs").Collected} */
    let collected;
    try {
      collected = await entry.collect(ctx);
    } catch (error) {
      collected = Object.fromEntries(
        entry.keys.map((key) => [
          key,
          { notMeasured: `collector ${entry.name} failed: ${messageOf(error)}` },
        ]),
      );
    }
    for (const [key, outcome] of Object.entries(collected)) {
      if ("notMeasured" in outcome) notMeasured[key] = outcome.notMeasured;
      else sidecar[key] = outcome.value;
    }
  }

  if (!flags.collectOnly) {
    if (!isSet(ctx.env, "AUDIT_AGENT_KEY") || ctx.siteUrl === "") {
      notMeasured["record_run"] = "AUDIT_AGENT_KEY or SITE_URL unset";
    } else {
      const answer = await agentRequest(ctx, RECORD_RUN_PATH, "POST");
      if (answer.status >= 200 && answer.status < 300)
        sidecar["record_run"] = { status: answer.status };
      else notMeasured["record_run"] = answer.reason;
    }
  }

  const front = {
    date,
    run_id: `audit-${date}`,
    schedule: flags.manual ? "manual" : "scheduled",
    site_url: ctx.siteUrl,
    previous: previousSidecar(root, date),
    tools: { node: process.version },
    sources_configured: [...REQUIRED, ...OPTIONAL].filter((name) => isSet(ctx.env, name)),
  };
  const file = resolve(root, DATA_DIR, `${date}.json`);
  mkdirSync(resolve(root, DATA_DIR), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ front, ...sidecar, not_measured: notMeasured }, null, 2)}\n`,
  );
  log(`wrote ${relative(root, file).replaceAll("\\", "/")}`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = await runAll({ argv: process.argv.slice(2), ctx: makeContext() });
}
