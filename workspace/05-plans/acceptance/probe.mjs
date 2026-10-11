import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHROME_ARGS, findChrome, writeRetry } from "../../../launch/engine/chrome.mjs";

// The shared probes of the acceptance panel (plan H2): the only way the panelists look at the dev deploy, the database,
// the Worker logs, Sentry and the advisors, so two panelists see the same console line.
//   node workspace/05-plans/acceptance/probe.mjs page <path>
//   node workspace/05-plans/acceptance/probe.mjs journey <name>
//   node workspace/05-plans/acceptance/probe.mjs db <query file>
//   node workspace/05-plans/acceptance/probe.mjs logs <minutes>
//   node workspace/05-plans/acceptance/probe.mjs sentry
//   node workspace/05-plans/acceptance/probe.mjs advisors
// Credentials come from the shell, loaded from `app/` with `eval "$(node scripts/load-env.mjs --profile dev)"` and
// `--profile ops` (never the shell's own SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, GOTCHAS G-901). A probe whose
// service or credential is missing prints `BLOCKED: <why>` and exits 3; any other failure exits 1.
// `logs` reads CLOUDFLARE_API_TOKEN, which no profile loads: on 2026-10-10 the one already in the agent shell answered
// 403 and the one in the repository's `.env` answered 200. Load it the standing way, without printing:
//   set -a; . <(tr -d '\r' < .env | grep -E '^[A-Z0-9_]+='); set +a
// `page` takes its route as written ("/" arrives intact: Git Bash's rewriting of a leading slash is undone, P-015).
// A journey file (journeys/<name>.json) holds { charter, writes?, after?, needs?, viewports?, steps }. `viewports`
// lists "desktop" and/or "phone" (default desktop) and the steps replay once on each; a failure on one does not skip
// the other. Selectors are CSS or Puppeteer's (`::-p-aria(Property address)`, `::-p-text(Continue)`). Steps:
//   goto {path, status?}   any answer under 400, or the one `status` names
//   click {selector}       fill {selector, value} (a select takes an option's value)
//   upload {selector, file} (a path from the repository root)
//   press {key, times?}    type {text} (into the element that has focus)
//   offline {value: on|off}   cuts the page's network and restores it
//   expectText {text}      case-insensitive, a line break counts as a space (the site sets labels in capitals by
//                          style and puts a heading and its sentence in separate blocks)
//   expectUrl {contains}   expectSelector / expectNoSelector {selector}   expectFocus {selector}
//   expectImageLoaded {selector}   the first match is an image that loaded
// In a value or a path, `{stamp}` is one token per run (a fresh address each time), `{yesterday}` the date 36 hours
// ago (a date received that no time zone calls future) and `{env:NAME}` the shell's NAME, never printed (a failing
// step shows the name). `needs` lists what the replay depends on; a missing one prints `BLOCKED: <journey>: <why>`
// and exits 3:
//   coming-soon          the dev deploy lists no property (the global flag is on)
//   env:NAME             NAME is set. The staff journeys need ACCEPTANCE_STAFF_TOKEN_HASH, the hashed token of a
//                        magic link for a staff address, minted the way app/tests/e2e/helpers/session.ts does it
//                        (a magic link is spent once, so one hash opens one journey); the probe mints nothing.
//                        place-notes-confirm needs ACCEPTANCE_CONFIRM_PATH, the path and query of the confirm link in
//                        the Place Notes mail (/api/public/subscribers/confirm?token=...).
// `writes` says what a replay leaves behind on the dev deploy; `after` names the journey whose writes this one starts
// from (the admin journeys work the request that `submission` made).

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const BASE_URL =
  process.env["ACCEPTANCE_URL"] ?? "https://matter-of-place-dev.holy-meadow-4327.workers.dev";
const WORKER = "matter-of-place-dev";
const SENTRY_PROJECT = "javascript-tanstackstart-react";
const SHOTS = join(REPO_ROOT, "scratch/acceptance");
const REQUEST_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const START_ATTEMPTS = 4;
const VIEWPORTS = [
  { name: "desktop", size: { width: 1440, height: 900, deviceScaleFactor: 1 } },
  {
    name: "phone",
    size: {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  },
];
const STEPS = [
  "goto",
  "click",
  "fill",
  "upload",
  "press",
  "type",
  "offline",
  "expectText",
  "expectUrl",
  "expectSelector",
  "expectNoSelector",
  "expectImageLoaded",
  "expectFocus",
];
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const YESTERDAY = new Date(Date.now() - 36 * 3_600_000).toISOString().slice(0, 10);
const FORBIDDEN_STATEMENT =
  /^\\|^(commit|end|abort|rollback|begin|start|release|savepoint|prepare\s+transaction)\b|^set\b[\s\S]*\b(transaction|read_only|characteristics|read\s+write)\b/i;

class Blocked extends Error {}

/**
 * @param {string} name
 * @returns {string}
 */
function need(name) {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Blocked(`${name} is not set in this shell (load the profile named in probe.mjs)`);
  return value;
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} what
 * @returns {Promise<any>}
 */
async function getJson(url, init, what) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Blocked(`${what} answered ${String(response.status)}`);
  return response.json();
}

/** @returns {Promise<any>} */
async function launch() {
  const fromApp = createRequire(join(REPO_ROOT, "app/package.json"));
  const puppeteer = await import(pathToFileURL(fromApp.resolve("puppeteer-core")).href);
  return puppeteer.default.launch({
    executablePath: findChrome(),
    headless: true,
    args: CHROME_ARGS,
  });
}

/**
 * The route an argument names. Git Bash rewrites an argument that starts with "/" into its own folder (GOTCHAS P-015),
 * so "/" arrives as "C:/Program Files/Git/"; the folder is taken off again.
 * @param {string | undefined} argument
 * @returns {string | undefined}
 */
function routeOf(argument) {
  const gitRoot = (process.env["EXEPATH"] ?? "").replace(/[\\/]bin$/, "").replaceAll("\\", "/");
  const text = (argument ?? "").replaceAll("\\", "/");
  const route = gitRoot !== "" && text.startsWith(gitRoot) ? text.slice(gitRoot.length) : text;
  return route.startsWith("/") ? route : undefined;
}

/**
 * @param {string} path
 * @returns {string}
 */
const slugOf = (path) => path.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-") || "home";

/**
 * @param {any} browser
 * @param {string} path
 * @param {{ name: string, size: Record<string, unknown> }} viewport
 */
async function visit(browser, path, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport.size);
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const failed = [];
  page.on("console", (/** @type {any} */ message) => {
    if (message.type() === "error")
      consoleErrors.push(`${message.text()} (${message.location().url ?? ""})`);
  });
  page.on("pageerror", (/** @type {Error} */ error) =>
    consoleErrors.push(`uncaught: ${error.message}`),
  );
  page.on("requestfailed", (/** @type {any} */ request) =>
    failed.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`),
  );
  page.on("response", (/** @type {any} */ response) => {
    if (response.status() >= 400) failed.push(`${String(response.status())} ${response.url()}`);
  });
  const response = await page.goto(new URL(path, BASE_URL).href, {
    waitUntil: "load",
    timeout: 45_000,
  });
  await page.evaluate(() => document.fonts.ready);
  const idle = await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );
  mkdirSync(SHOTS, { recursive: true });
  const shot = join(SHOTS, `${slugOf(path)}-${viewport.name}.png`);
  await writeRetry(shot, await page.screenshot({ type: "png" }));
  await page.close();
  return {
    viewport,
    status: response?.status() ?? 0,
    headers: response?.headers() ?? {},
    consoleErrors,
    failed,
    idle,
    shot,
  };
}

/** @param {string[]} args */
async function pageProbe(args) {
  const path = routeOf(args[0]);
  if (path === undefined) throw new Error("usage: probe.mjs page </path>");
  const browser = await launch();
  try {
    const visits = [];
    for (const viewport of VIEWPORTS) visits.push(await visit(browser, path, viewport));
    console.log(`page ${path} on ${BASE_URL}`);
    for (const v of visits) {
      const { width, height } = v.viewport.size;
      console.log(
        `[${v.viewport.name} ${String(width)}x${String(height)}] status ${String(v.status)}, console errors ${String(v.consoleErrors.length)}, failed requests ${String(v.failed.length)}${v.idle ? "" : ", network still busy after 8 s"}`,
      );
      for (const line of v.consoleErrors) console.log(`  console: ${line}`);
      for (const line of v.failed) console.log(`  failed: ${line}`);
      console.log(`  screenshot ${v.shot}`);
    }
    console.log("document headers (desktop):");
    for (const [name, value] of Object.entries(visits[0]?.headers ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      console.log(`  ${name}: ${value}`);
    }
  } finally {
    await browser.close();
  }
}

/**
 * A value with its `{stamp}`, `{yesterday}` and `{env:NAME}` filled in.
 * @param {string | undefined} text
 * @returns {string}
 */
const filled = (text) =>
  (text ?? "")
    .replaceAll("{stamp}", STAMP)
    .replaceAll("{yesterday}", YESTERDAY)
    .replace(/\{env:([A-Z0-9_]+)\}/g, (_match, name) => need(name));

/**
 * Runs one step of a journey on the page; throws when it does not hold within the step timeout.
 * @param {any} page
 * @param {Record<string, string | number>} step
 */
async function runStep(page, step) {
  const timeout = STEP_TIMEOUT_MS;
  const selector = String(step["selector"] ?? "");
  switch (step["do"]) {
    case "goto": {
      const written = String(step["path"] ?? "");
      const path = filled(written);
      const response = await page.goto(new URL(path, BASE_URL).href, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      // Hydration follows the load event; analytics can keep the network busy for good, so the wait is bounded and
      // a busy network is not a failure of the step.
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => undefined);
      const status = response?.status() ?? 0;
      const wanted = Number(step["status"] ?? 0);
      if (wanted === 0 ? status >= 400 : status !== wanted)
        throw new Error(
          `${written} answered ${String(status)}${wanted === 0 ? "" : `, expected ${String(wanted)}`}`,
        );
      return;
    }
    case "click":
      await page.locator(selector).setTimeout(timeout).click();
      return;
    case "fill":
      await page
        .locator(selector)
        .setTimeout(timeout)
        .fill(filled(String(step["value"] ?? "")));
      return;
    case "upload": {
      const input = await page.waitForSelector(selector, { timeout });
      await input.uploadFile(join(REPO_ROOT, String(step["file"] ?? "")));
      return;
    }
    case "press":
      for (let time = 0; time < Number(step["times"] ?? 1); time += 1)
        await page.keyboard.press(String(step["key"] ?? ""));
      return;
    case "offline":
      await page.setOfflineMode(step["value"] === "on");
      return;
    case "type":
      await page.keyboard.type(filled(String(step["text"] ?? "")));
      return;
    case "expectText":
      await page.waitForFunction(
        (/** @type {string} */ text) =>
          document.body.innerText.replace(/s+/g, " ").toLowerCase().includes(text),
        { timeout },
        filled(String(step["text"] ?? ""))
          .replace(/s+/g, " ")
          .toLowerCase(),
      );
      return;
    case "expectUrl":
      await page.waitForFunction(
        (/** @type {string} */ part) => location.href.includes(part),
        { timeout },
        filled(String(step["contains"] ?? "")),
      );
      return;
    case "expectSelector":
      await page.waitForSelector(selector, { visible: true, timeout });
      return;
    case "expectNoSelector":
      await page.waitForSelector(selector, { hidden: true, timeout });
      return;
    case "expectImageLoaded": {
      const image = await page.waitForSelector(selector, { timeout });
      await page
        .waitForFunction(
          (/** @type {HTMLImageElement} */ target) => target.complete && target.naturalWidth > 0,
          { timeout },
          image,
        )
        .catch(async () => {
          throw new Error(
            `the image ${await image.evaluate((target) => target.currentSrc || target.src)} did not load`,
          );
        });
      return;
    }
    case "expectFocus": {
      const element = await page.waitForSelector(selector, { timeout });
      await page.waitForFunction(
        (/** @type {Element} */ target) => document.activeElement === target,
        { timeout },
        element,
      );
      return;
    }
    default:
      throw new Error(`unknown step ${String(step["do"])}`);
  }
}

/**
 * What a journey needs that the dev deploy or the shell does not give right now, or undefined when it has it all.
 * @param {string[]} needs
 * @returns {Promise<string | undefined>}
 */
async function missingNeed(needs) {
  for (const item of needs) {
    if (item.startsWith("env:")) {
      const name = item.slice(4);
      if ((process.env[name] ?? "") === "")
        return `${name} is not set in this shell (see the header of probe.mjs)`;
    } else if (item === "coming-soon") {
      const listed = await getJson(
        new URL("/api/public/properties", BASE_URL).href,
        {},
        "the property list",
      );
      if (!Array.isArray(listed) || listed.length !== 0)
        return `the dev deploy lists ${String(Array.isArray(listed) ? listed.length : "some")} properties, so the coming-soon flag is off (bun run test:e2e:coming-soon turns it on and back)`;
    } else {
      throw new Error(`unknown need ${item}; use coming-soon or env:NAME`);
    }
  }
  return undefined;
}

/** @param {string[]} args */
async function journeyProbe(args) {
  const [name] = args;
  const dir = join(HERE, "journeys");
  if (name === undefined)
    throw new Error(
      `usage: probe.mjs journey <name>; journeys: ${
        existsSync(dir)
          ? readdirSync(dir)
              .map((f) => f.replace(/\.json$/, ""))
              .join(", ")
          : "none yet"
      }`,
    );
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) throw new Error(`no journey ${name}: ${file} does not exist`);
  /** @type {{ viewports?: string[], needs?: string[], steps?: Record<string, string | number>[] }} */
  const journey = JSON.parse(readFileSync(file, "utf8"));
  const steps = journey.steps ?? [];
  const unknown = steps.findIndex((step) => !STEPS.includes(String(step["do"])));
  if (steps.length === 0 || unknown !== -1)
    throw new Error(
      `${name}.json: ${steps.length === 0 ? "no steps" : `step ${String(unknown + 1)} has an unknown "do"; use ${STEPS.join(", ")}`}`,
    );
  const viewports = (journey.viewports ?? ["desktop"]).map((wanted) => {
    const viewport = VIEWPORTS.find((v) => v.name === wanted);
    if (viewport === undefined) throw new Error(`${name}.json: viewports are desktop and phone`);
    return viewport;
  });
  const missing = await missingNeed(journey.needs ?? []);
  if (missing !== undefined) throw new Blocked(`journey ${name}: ${missing}`);
  const shellNames = [...JSON.stringify(steps).matchAll(/\{env:([A-Z0-9_]+)\}/g)].map((m) =>
    String(m[1]),
  );
  /** A browser error can quote the address it was given: a value taken from the shell is shown by its name. */
  const redact = (/** @type {string} */ text) =>
    shellNames.reduce((out, shellName) => {
      const value = process.env[shellName] ?? "";
      return value === "" ? out : out.replaceAll(value, `{env:${shellName}}`);
    }, text);
  const browser = await launch();
  try {
    for (const viewport of viewports) {
      for (let attempt = 1; ; attempt += 1) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport(viewport.size);
        /** @type {string[]} */
        const consoleErrors = [];
        page.on("console", (/** @type {any} */ message) => {
          if (message.type() === "error")
            consoleErrors.push(`${message.text()} (${message.location().url ?? ""})`);
        });
        page.on("pageerror", (/** @type {Error} */ error) =>
          consoleErrors.push(`uncaught: ${error.message}`),
        );
        let silent = false;
        let failed = false;
        for (const [index, step] of steps.entries()) {
          const label = `${String(index + 1)} ${JSON.stringify(step)}`;
          try {
            await runStep(page, step);
          } catch (error) {
            // Nothing is written before the first step, so a first request that gets no answer starts the journey
            // again on a new connection (the dev Worker leaves about half of them waiting, GOTCHAS P-3203).
            if (
              index === 0 &&
              attempt < START_ATTEMPTS &&
              error instanceof Error &&
              error.name === "TimeoutError"
            ) {
              silent = true;
              break;
            }
            console.log(
              `FAIL step ${label} [${viewport.name}]: ${redact(error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))}`,
            );
            mkdirSync(SHOTS, { recursive: true });
            const shot = join(SHOTS, `journey-${name}-${viewport.name}-failed.png`);
            await writeRetry(shot, await page.screenshot({ type: "png" }));
            console.log(`  screenshot ${shot}`);
            process.exitCode = 1;
            failed = true;
            break;
          }
          console.log(`ok   step ${label}`);
        }
        if (silent) {
          console.log(
            `  note: the first request got no answer in ${String(NAVIGATION_TIMEOUT_MS / 1000)} s (attempt ${String(attempt)} of ${String(START_ATTEMPTS)}), starting again`,
          );
          await context.close();
          continue;
        }
        if (failed) {
          await context.close();
          break;
        }
        console.log(
          `journey ${name} [${viewport.name}]: ok, ${String(steps.length)} steps, console errors ${String(consoleErrors.length)}`,
        );
        const counts = new Map();
        for (const line of consoleErrors) counts.set(line, (counts.get(line) ?? 0) + 1);
        for (const [line, count] of counts)
          console.log(`  console: ${line}${count > 1 ? ` (x${String(count)})` : ""}`);
        await context.close();
        break;
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * The statements of a query file that would end the read-only transaction, switch it off, or leave SQL (a psql
 * meta-command such as the shell escape starts with a backslash).
 * @param {string} sql
 * @returns {string[]}
 */
function forbiddenStatements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => FORBIDDEN_STATEMENT.test(statement));
}

/** @param {string[]} args */
function dbProbe(args) {
  const [file] = args;
  if (file === undefined || !existsSync(file)) throw new Error("usage: probe.mjs db <query file>");
  const url = need("DEV_DB_URL");
  const ref = need("DEV_SUPABASE_PROJECT_REF");
  if (!url.includes(ref))
    throw new Error("DEV_DB_URL does not name DEV_SUPABASE_PROJECT_REF: not mop-dev, refusing");
  const refused = forbiddenStatements(readFileSync(file, "utf8"));
  if (refused.length > 0)
    throw new Error(
      `read only: the file holds ${refused.map((s) => JSON.stringify(s.slice(0, 40))).join(", ")}`,
    );
  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "app/scripts/psql-dev.mjs"),
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "begin read only",
      "-c",
      "set local statement_timeout = '20s'",
      "-f",
      file,
      "-c",
      "rollback",
    ],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status === 0 ? 0 : 1;
}

/**
 * @param {Record<string, any>} event
 * @param {string} path
 * @returns {any}
 */
const at = (event, path) => path.split(".").reduce((value, key) => value?.[key], event);

/** @param {string[]} args */
async function logsProbe(args) {
  const minutes = Number(args[0] ?? "15");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Error("usage: probe.mjs logs <minutes 1..1440>");
  const now = Date.now();
  const body = {
    queryId: "h2-probe",
    timeframe: { from: now - minutes * 60_000, to: now },
    view: "events",
    limit: 1000,
    parameters: {
      filters: [
        {
          key: "$metadata.service",
          operation: "eq",
          type: "string",
          value: WORKER,
        },
      ],
    },
  };
  const data = await getJson(
    `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Workers Logs",
  );
  /** @type {Record<string, any>[]} */
  const events = (at(data, "result.events.events") ?? []).sort(
    (/** @type {any} */ a, /** @type {any} */ b) => a.timestamp - b.timestamp,
  );
  const requests = events.filter(
    (event) =>
      at(event, "$metadata.type") === "cf-worker-event" &&
      at(event, "$workers.eventType") === "fetch",
  );
  const appLines = events.filter((event) => at(event, "$metadata.type") === "cf-worker");
  const lines = appLines.filter((event) =>
    ["warn", "error"].includes(String(at(event, "$metadata.level"))),
  );
  const appIds = new Map(
    appLines
      .filter((event) => typeof at(event, "source.requestId") === "string")
      .map((event) => [at(event, "$metadata.requestId"), at(event, "source.requestId")]),
  );
  /** @param {Record<string, any>} event the id the app answers with in x-request-id, or Cloudflare's when no app line carried it */
  const requestId = (event) =>
    String(
      appIds.get(at(event, "$metadata.requestId")) ??
        `cf:${String(at(event, "$metadata.requestId"))}`,
    );
  /** @type {Record<string, number>} */
  const byStatus = {};
  console.log(
    `${WORKER}, last ${String(minutes)} min (${String(events.length)} events${events.length >= 1000 ? ", truncated at 1000" : ""})`,
  );
  for (const event of requests) {
    const url = new URL(String(at(event, "$workers.event.request.url")));
    const status = String(at(event, "$workers.event.response.status") ?? "-");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    console.log(
      `${new Date(event.timestamp).toISOString().slice(11, 19)} ${String(at(event, "$workers.event.request.method"))} ${url.pathname}${url.search} ${status} ${String(at(event, "$workers.outcome"))} ${String(at(event, "$workers.wallTimeMs"))}ms req=${requestId(event)}`,
    );
  }
  for (const event of lines) {
    console.log(
      `${new Date(event.timestamp).toISOString().slice(11, 19)} ${String(at(event, "$metadata.level"))} ${JSON.stringify(event.source).slice(0, 300)} req=${requestId(event)}`,
    );
  }
  console.log(
    `requests ${String(requests.length)}: ${
      Object.entries(byStatus)
        .map(([status, count]) => `${status}=${String(count)}`)
        .join(" ") || "none"
    }; warn or error lines ${String(lines.length)}`,
  );
}

async function sentryProbe() {
  const org = process.env["SENTRY_ORG"] ?? "matter-of-place";
  const issues = await getJson(
    `https://sentry.io/api/0/projects/${org}/${SENTRY_PROJECT}/issues/?query=is:unresolved&limit=100`,
    { headers: { authorization: `Bearer ${need("SENTRY_AUTH_TOKEN")}` } },
    "Sentry",
  );
  console.log(`sentry ${org}/${SENTRY_PROJECT}: ${String(issues.length)} unresolved issues`);
  for (const issue of issues) {
    console.log(
      `${String(issue.shortId)} ${String(issue.level)} count=${String(issue.count)} users=${String(issue.userCount)} last=${String(issue.lastSeen)} ${String(issue.title).slice(0, 100)} @ ${String(issue.culprit).slice(0, 80)}`,
    );
  }
}

async function advisorsProbe() {
  const token = need("SUPABASE_ACCESS_TOKEN");
  const ref = need("DEV_SUPABASE_PROJECT_REF");
  const order = ["ERROR", "WARN", "INFO"];
  for (const kind of ["security", "performance"]) {
    const data = await getJson(
      `https://api.supabase.com/v1/projects/${ref}/advisors/${kind}`,
      { headers: { authorization: `Bearer ${token}` } },
      `the ${kind} advisors`,
    );
    /** @type {Record<string, any>[]} */
    const lints = (data.lints ?? []).sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        order.indexOf(a.level) - order.indexOf(b.level),
    );
    console.log(
      `${kind} advisors: ${String(lints.length)} lints (${order.map((level) => `${level} ${String(lints.filter((lint) => lint["level"] === level).length)}`).join(", ")})`,
    );
    for (const lint of lints)
      console.log(
        `  ${String(lint["level"])} ${String(lint["name"])}: ${String(lint["detail"]).replaceAll("\n", " ").slice(0, 200)}`,
      );
  }
}

const COMMANDS = {
  page: pageProbe,
  journey: journeyProbe,
  db: dbProbe,
  logs: logsProbe,
  sentry: sentryProbe,
  advisors: advisorsProbe,
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const run = Object.entries(COMMANDS).find(([name]) => name === command)?.[1];
  if (run === undefined) {
    console.error(`usage: probe.mjs <${Object.keys(COMMANDS).join("|")}> [argument]`);
    process.exitCode = 2;
    return;
  }
  try {
    await run(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error instanceof Blocked ? `BLOCKED: ${message}` : message);
    process.exitCode = error instanceof Blocked ? 3 : 1;
  }
}

await main();
