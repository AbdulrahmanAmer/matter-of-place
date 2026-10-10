// `bun run scripts/harden/cache-probe.ts --mode memory,identical,never,writes,edge,keepwarm <baseUrl> [n]` (H1-40, H1-41,
// H1-34): the proof of the caching contract (S52, architecture 13) against a running Worker, `bunx wrangler dev` locally
// and the custom domain at L1. Several modes may be given, comma separated; each prints `cache <mode> ok (...)` or one
// `cache <mode>: <problem>` line per miss of the contract, and the exit code is 1 when any mode missed.
//   memory     a catalog version bump, then 1,000 requests over the public pages, the catalog endpoints and search, so
//              every stored answer is rebuilt once inside the window; the database sees `public_state`
//              at most once per 15 seconds of elapsed time plus one, `public_catalog_snapshot` at most once per version
//              seen, and no other statement of the Worker's own kind.
//   identical  a cached page is byte-identical whatever the cookie, language, agent or query; two fresh renders
//              (a preview request is never stored) differ in nothing but clock values and the hashes of the scripts that
//              carry them; no `nonce-` anywhere; a render that was just stored and its hit have one policy.
//   never      rule 6: a write, `/api/admin/*`, `/api/hooks/*`, `/admin`, the 405 and 404 the pipeline writes and a preview
//              page answer `no-store` and never `x-mop-cache: hit`, twice in a row. Three cacheable reads are also
//              checked for a cookie or a 5xx, which must be `no-store` too; no request here makes the Worker set a
//              cookie or fail, so those two classes are proved by `tests/unit/cache.test.ts` only (UNPROVEN here).
//   writes     30 POSTs without a Turnstile token and 30 more over the memory limit add 0 database statements.
//   edge       the stored copy is served: a new key is a miss then a hit, a random query string still hits, and
//              `n` (default 400) GETs after one warm-up pass hit 95 percent of the time. `--fixture <file>` reads a
//              recorded JSON list of `x-mop-cache` values instead of sending requests (the offline input of the ratio).
//   keepwarm   the `scheduled()` tick (the Worker runs under `--test-scheduled`) makes exactly one `public_state`
//              statement once the memo has expired, and `/` is still a hit afterwards.
// Statements are counted in `pg_stat_statements` of the one database through `$DEV_DB_URL` (E15), for the role the Worker
// uses (the job runner and every lane use it too), so no endpoint exposes counts. The modes that count refuse a
// production database (ruling H35 (5)), take the writer lock (G34) for at most 3 minutes, wait until nobody else has
// used the database for 3 seconds in a row, ignore the job runner's own statements by name, and run a second time when
// they miss, passing only if the second run is clean. When the lock or an idle database never comes they print
// `BLOCKED cache <mode> ...` (UNPROVEN, not a miss) and the exit code stays 0 unless another mode missed.
import { readFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { LockBusy, openProbeDb, type ProbeDb } from "./probe-db.ts";

const MODES = ["memory", "identical", "never", "writes", "edge", "keepwarm"] as const;
type Mode = (typeof MODES)[number];
const COUNTING: ReadonlySet<Mode> = new Set(["memory", "writes", "keepwarm"]);

const TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
const MEMO_MS = 15_000;
const QUIET_SECONDS = 3;
const QUIET_LIMIT_MS = 90_000;
const LOCK_WAIT_MS = 180_000;
const MEMORY_REQUESTS = 1000;
const SEARCH_EVERY = 20;
const WRITE_POSTS = 30;
const EDGE_REQUESTS = 400;
const HIT_RATIO = 0.95;
const SCHEDULED = "/cdn-cgi/handler/scheduled?cron=*%2F10+*+*+*+*";
// Two renders of one page differ in the clock values the router writes into the page: 13-digit epoch milliseconds.
const EPOCH_MS = /\b1\d{12}\b/g;
const STATE = "rpc public_state";
const SNAPSHOT = "rpc public_catalog_snapshot";
// The statements of the job runner, the keep-warm tick and the heartbeat (`runner.ts`, `claim.ts`, `fanout.ts`, `scheduled.ts`):
// the same role runs them against the same database, and they are not a public read.
const BACKGROUND: ReadonlySet<string> = new Set([
  "rpc beat",
  "rpc claim_job",
  "rpc finish_job",
  "rpc fail_job",
  "rpc requeue_job",
  "rpc reap_stale_jobs",
  "rpc fanout_pending_events",
  "rpc job_queue_read",
  "rpc job_queue_delete",
  "rpc claim_schedule",
  "rpc jobs_liveness",
  "table jobs",
  "table schedule_settings",
]);
const PLUMBING = "plumbing";

interface Reply {
  status: number;
  headers: Headers;
  text: string;
}

interface ModeResult {
  detail: string;
  problems: string[];
}

interface Targets {
  pages: string[];
  json: string[];
  term: string;
}

interface Context {
  base: string;
  requests: number;
  /** The writer's connection, or undefined with `unavailable` saying why the lock could not be had. */
  db: ProbeDb | undefined;
  unavailable: string;
}

type Snapshot = Map<string, { label: string; calls: number }>;

const slugs = z.array(z.object({ slug: z.string(), title: z.string().optional() }));
const labels = z.array(z.string());

/** A client address of the documentation range, new for each run, so no earlier run has filled its memory buckets. */
const freshIp = (): string =>
  `2001:db8::${Date.now().toString(16)}:${Math.floor(Math.random() * 65_535).toString(16)}`;

async function send(base: string, path: string, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

const label = (reply: Reply): string => reply.headers.get("x-mop-cache") ?? "none";
const isNoStore = (reply: Reply): boolean => reply.headers.get("cache-control") === "no-store";
const inquiryBody = (): string =>
  readFileSync(new URL("../../tests/fixtures/inquiry.json", import.meta.url), "utf8");

async function pool(
  count: number,
  size: number,
  work: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < count) {
      const index = next;
      next += 1;
      await work(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, count) }, lane));
}

/** Collects problems by kind, so a thousand identical failures print as one line with a count. */
function tally(): { add: (problem: string) => void; list: () => string[] } {
  const counts = new Map<string, number>();
  return {
    add: (problem) => counts.set(problem, (counts.get(problem) ?? 0) + 1),
    list: () =>
      [...counts].map(([problem, count]) =>
        count === 1 ? problem : `${problem} (x${String(count)})`,
      ),
  };
}

/** The pages and catalog endpoints a visitor reaches: what the catalog holds decides the detail paths. */
async function discover(base: string): Promise<Targets> {
  const first = async (path: string): Promise<{ slug: string; title: string } | undefined> => {
    const reply = await send(base, path);
    const parsed = slugs.safeParse(JSON.parse(reply.text));
    const entry = parsed.success ? parsed.data[0] : undefined;
    return entry === undefined ? undefined : { slug: entry.slug, title: entry.title ?? "" };
  };
  const property = await first("/api/public/properties");
  const market = await first("/api/public/markets");
  const story = await first("/api/public/stories");
  const pages = ["/", "/properties", "/exposure", "/submit", "/markets", "/stories"];
  const json = [
    "/api/public/properties",
    "/api/public/markets",
    "/api/public/stories",
    "/api/public/site",
  ];
  if (property !== undefined) {
    pages.push(`/property/${property.slug}`);
    json.push(`/api/public/properties/${property.slug}`);
  }
  if (market !== undefined) {
    pages.push(`/${market.slug}`);
    json.push(`/api/public/markets/${market.slug}`);
  }
  if (story !== undefined) {
    pages.push(`/stories/${story.slug}`);
    json.push(`/api/public/stories/${story.slug}`);
  }
  const word = (property?.title ?? "")
    .split(/[^A-Za-z]+/)
    .reduce((longest, next) => (next.length > longest.length ? next : longest), "");
  return { pages, json, term: word.length >= 5 ? word : "house" };
}

function labelOf(query: string): string {
  const rpc = /"public"\."([a-z0-9_]+)"\s*\(/.exec(query)?.[1];
  if (rpc !== undefined) return `rpc ${rpc}`;
  const table = /\b(?:from|into|update)\s+"public"\."([a-z0-9_]+)"/i.exec(query)?.[1];
  if (table !== undefined) return `table ${table}`;
  if (query.startsWith("select set_config('search_path'") || /^(?:begin|commit)\b/i.test(query))
    return PLUMBING;
  return `other ${query.slice(0, 60)}`;
}

/** The statements the Worker's role has run, by query id (`calls` only ever grows until the statistics are reset). */
async function statements(db: ProbeDb): Promise<Snapshot> {
  const rows = await db.rows(
    `select queryid::text as id, sum(calls)::text as calls, regexp_replace(min(left(query, 600)), '[[:space:]]+', ' ', 'g') as q
       from extensions.pg_stat_statements
      where userid = (select oid from pg_roles where rolname = 'service_role')
        and dbid = (select oid from pg_database where datname = current_database())
      group by queryid`,
  );
  const snapshot: Snapshot = new Map();
  for (const row of rows) {
    if (row["id"] === null || row["id"] === undefined) continue;
    snapshot.set(row["id"], { label: labelOf(row["q"] ?? ""), calls: Number(row["calls"]) });
  }
  return snapshot;
}

/** Calls made between two snapshots, by label; a query evicted and recreated in between counts from zero. */
function between(before: Snapshot, after: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [id, now] of after) {
    const was = before.get(id)?.calls ?? 0;
    const added = now.calls >= was ? now.calls - was : now.calls;
    if (added > 0) counts.set(now.label, (counts.get(now.label) ?? 0) + added);
  }
  return counts;
}

/** The labels of a count that are neither plumbing, the runner's, nor `allowed`, as `<label> x<calls>`. */
function strays(counts: ReadonlyMap<string, number>, allowed: ReadonlySet<string>): string[] {
  return [...counts]
    .filter(([name]) => name !== PLUMBING && !BACKGROUND.has(name) && !allowed.has(name))
    .map(([name, calls]) => `${name} x${String(calls)}`);
}

/** The database was never idle long enough to count against: the mode proves nothing, it is not a miss of the contract. */
class Busy extends Error {}

/** The writer's connection once nobody else has used the database for QUIET_SECONDS in a row, or `Busy` after QUIET_LIMIT_MS. */
async function quietDb(context: Context): Promise<ProbeDb> {
  const { db } = context;
  if (db === undefined) throw new Busy(context.unavailable);
  const deadline = Date.now() + QUIET_LIMIT_MS;
  let last = await statements(db);
  let quiet = 0;
  let foreign: string[] = [];
  while (quiet < QUIET_SECONDS) {
    if (Date.now() > deadline) {
      throw new Busy(
        `the database was not idle for ${String(QUIET_SECONDS)} s within ${String(QUIET_LIMIT_MS / 1000)} s, another client ran ${foreign.join(", ")}`,
      );
    }
    await pause(1000);
    const now = await statements(db);
    foreign = strays(between(last, now), new Set());
    quiet = foreign.length === 0 ? quiet + 1 : 0;
    last = now;
  }
  return db;
}

async function memory(context: Context): Promise<ModeResult> {
  const db = await quietDb(context);
  const targets = await discover(context.base);
  // A new catalog version makes every stored page and answer a miss once, so the loaders run inside the window.
  await db.rows("select public.bump_catalog_version()::text as version");
  await pause(MEMO_MS + 1000);
  await quietDb(context);
  const paths = [...targets.pages, ...targets.json];
  const searches = [targets.term, `${targets.term}s`, targets.term.slice(0, 3)];
  const ip = freshIp();
  const seen = new Set<string>();
  const problems = tally();
  const before = await statements(db);
  const started = Date.now();
  await pool(MEMORY_REQUESTS, CONCURRENCY, async (index) => {
    const search = index % SEARCH_EVERY === SEARCH_EVERY - 1;
    const path = search ? "/api/public/search" : (paths[index % paths.length] ?? "/");
    const reply = await send(context.base, path, {
      headers: {
        "cf-connecting-ip": ip,
        ...(search ? { "content-type": "application/json" } : {}),
      },
      ...(search
        ? {
            method: "POST",
            body: JSON.stringify({
              text: searches[Math.floor(index / SEARCH_EVERY) % searches.length],
            }),
          }
        : {}),
    });
    const version = reply.headers.get("x-catalog-version");
    if (reply.status !== 200) problems.add(`${path} answered ${String(reply.status)}`);
    if (!reply.headers.has("x-mop-cache")) problems.add(`${path} has no x-mop-cache`);
    if (version === null) problems.add(`${path} has no x-catalog-version`);
    else seen.add(version);
  });
  const elapsed = (Date.now() - started) / 1000;
  const counts = between(before, await statements(db));
  const state = counts.get(STATE) ?? 0;
  const snapshot = counts.get(SNAPSHOT) ?? 0;
  const bound = Math.ceil(elapsed / (MEMO_MS / 1000)) + 1;
  if (state > bound)
    problems.add(
      `public_state ran ${String(state)} times in ${elapsed.toFixed(0)} s, at most ${String(bound)}`,
    );
  if (snapshot > seen.size)
    problems.add(
      `public_catalog_snapshot ran ${String(snapshot)} times for ${String(seen.size)} catalog versions`,
    );
  for (const stray of strays(counts, new Set([STATE, SNAPSHOT])))
    problems.add(`the Worker ran ${stray}`);
  return {
    detail: `${String(MEMORY_REQUESTS)} requests in ${elapsed.toFixed(0)} s: public_state ${String(state)} (at most ${String(bound)}), public_catalog_snapshot ${String(snapshot)} (versions seen ${String(seen.size)}), other 0`,
    problems: problems.list(),
  };
}

function csp(reply: Reply): string {
  return (
    reply.headers.get("content-security-policy") ??
    reply.headers.get("content-security-policy-report-only") ??
    ""
  );
}

async function identical(context: Context): Promise<ModeResult> {
  const { base } = context;
  const problems = tally();
  const variants: RequestInit[] = [
    { headers: { cookie: "h1=probe; consent=yes" } },
    { headers: { "accept-language": "fr-CA,fr;q=0.8" } },
    { headers: { "user-agent": "h1-probe/1.0 (another agent)" } },
    { headers: { "user-agent": "h1-probe/1.0", cookie: "a=1", "accept-language": "de" } },
  ];
  const pages = ["/", "/properties"];
  for (const page of pages) {
    const reference = await send(base, page);
    const stored = await send(base, page);
    if (label(stored) !== "hit")
      problems.add(`${page} is not a hit on its second request (${label(stored)})`);
    const query = await send(base, `${page}?h1=${Math.random().toString(36).slice(2)}`);
    for (const reply of [
      stored,
      query,
      ...(await Promise.all(variants.map((init) => send(base, page, init)))),
    ]) {
      if (reply.text !== stored.text)
        problems.add(
          `${page}: a request that differs in cookie, language, agent or query got other bytes`,
        );
      if (csp(reply) !== csp(stored))
        problems.add(`${page}: the Content-Security-Policy differs between requests`);
    }
    // A preview request is rendered every time and stored never: two renders show whether the page depends on the visitor.
    const first = await send(
      base,
      `${page}?preview=h1-${Math.random().toString(36).slice(2)}`,
      variants[0],
    );
    const second = await send(
      base,
      `${page}?preview=h1-${Math.random().toString(36).slice(2)}`,
      variants[2],
    );
    const hashless = (policy: string): string => policy.replace(/ 'sha256-[^']+'/g, "");
    const flat = (text: string): string => text.replace(EPOCH_MS, "T");
    if (flat(first.text) !== flat(second.text) || flat(first.text) !== flat(reference.text)) {
      problems.add(`${page}: two renders differ beyond clock values`);
    }
    if (hashless(csp(first)) !== hashless(csp(second))) {
      problems.add(`${page}: two renders carry different Content-Security-Policy headers`);
    }
    if (
      label(reference) === "miss" &&
      (reference.text !== stored.text || csp(reference) !== csp(stored))
    ) {
      problems.add(
        `${page}: the render that was stored and its hit differ in body or Content-Security-Policy`,
      );
    }
    for (const reply of [reference, stored, first, second]) {
      if (csp(reply) === "") problems.add(`${page}: no Content-Security-Policy header`);
      if (csp(reply).includes("nonce-") || reply.text.includes("nonce-"))
        problems.add(`${page}: a nonce- token in the policy or the body`);
    }
  }
  return {
    detail: `${pages.join(" and ")}: ${String(variants.length + 2)} stored variants byte-identical, two renders equal apart from clock values, one policy, no nonce-`,
    problems: problems.list(),
  };
}

async function never(context: Context): Promise<ModeResult> {
  const { base } = context;
  const targets = await discover(context.base);
  const property = targets.pages.find((page) => page.startsWith("/property/"));
  const json = { "content-type": "application/json" };
  const ip = { "cf-connecting-ip": freshIp() };
  const rows: { name: string; path: string; init?: RequestInit }[] = [
    {
      name: "public write",
      path: "/api/public/inquiries",
      init: { method: "POST", headers: { ...json, ...ip }, body: inquiryBody() },
    },
    {
      name: "405 on a read route",
      // No body: three runs in a row got a 500 ("Network connection lost") from wrangler dev's proxy for a POST with a body to this route.
      path: "/api/public/properties",
      init: { method: "POST" },
    },
    { name: "unknown api route", path: `/api/public/nothing-here-${Date.now().toString(36)}` },
    { name: "admin api", path: "/api/admin/me" },
    { name: "admin page", path: "/admin" },
    {
      name: "hook",
      path: "/api/hooks/resend",
      init: { method: "POST", headers: json, body: "{}" },
    },
    { name: "preview of a json read", path: "/api/public/properties/h1-probe?preview=h1-probe" },
    ...(property === undefined
      ? []
      : [{ name: "preview page", path: `${property}?preview=h1-probe` }]),
  ];
  const problems = tally();
  for (const row of rows) {
    for (let round = 1; round <= 2; round += 1) {
      const reply = await send(base, row.path, row.init);
      if (!isNoStore(reply))
        problems.add(
          `${row.name} ${row.path} answered ${String(reply.status)} with cache-control ${JSON.stringify(reply.headers.get("cache-control"))}`,
        );
      if (["hit", "stale"].includes(label(reply)))
        problems.add(
          `${row.name} ${row.path} was served from the store (x-mop-cache ${label(reply)})`,
        );
    }
  }
  const guarded = [...targets.pages, ...targets.json];
  for (const path of guarded.slice(0, 3)) {
    const reply = await send(base, path, { headers: { cookie: "h1=probe" } });
    if (reply.headers.has("set-cookie") && !isNoStore(reply))
      problems.add(`${path} sets a cookie and is not no-store`);
    if (reply.status >= 500 && !isNoStore(reply))
      problems.add(`${path} answered ${String(reply.status)} and is not no-store`);
  }
  return {
    detail: `${String(rows.length)} routes asked twice, none stored or served from the store; ${String(guarded.slice(0, 3).length)} cacheable reads checked for a cookie or a 5xx`,
    problems: problems.list(),
  };
}

async function writes(context: Context): Promise<ModeResult> {
  const db = await quietDb(context);
  const problems = tally();
  const headers = { "content-type": "application/json", "cf-connecting-ip": freshIp() };
  const start = await db.now();
  const before = await statements(db);
  const answers: number[] = [];
  for (let sent = 0; sent < 2 * WRITE_POSTS; sent += 1) {
    const reply = await send(context.base, "/api/public/inquiries", {
      method: "POST",
      headers,
      body: inquiryBody(),
    });
    answers.push(reply.status);
  }
  const counts = between(before, await statements(db));
  const refused = answers.slice(0, WRITE_POSTS).filter((status) => status !== 403).length;
  const limited = answers.slice(WRITE_POSTS).filter((status) => status !== 429).length;
  if (refused > 0)
    problems.add(
      `${String(refused)} of the first ${String(WRITE_POSTS)} POSTs without a token were not answered 403`,
    );
  if (limited > 0)
    problems.add(
      `${String(limited)} of the next ${String(WRITE_POSTS)} POSTs over the memory limit were not answered 429`,
    );
  for (const stray of strays(counts, new Set()))
    problems.add(`${String(2 * WRITE_POSTS)} refused writes ran ${stray}`);
  const hits = await db.rows(
    "select id::text as id from rate_limits where bucket like 'inquiries:%' and at >= $1",
    [start],
  );
  await db.cleanup({
    rate_limits: hits.flatMap((row) =>
      row["id"] === null || row["id"] === undefined ? [] : [row["id"]],
    ),
  });
  return {
    detail: `${String(WRITE_POSTS)} POSTs without a token (403) and ${String(WRITE_POSTS)} over the memory limit (429) added 0 database statements`,
    problems: problems.list(),
  };
}

function ratioOf(values: readonly string[]): { percent: number; problems: string[] } {
  const hits = values.filter((value) => value === "hit").length;
  const percent = values.length === 0 ? 0 : Math.round((hits / values.length) * 1000) / 10;
  if (values.length > 0 && hits / values.length >= HIT_RATIO) return { percent, problems: [] };
  const hint =
    hits === 0
      ? " (no request was ever served from the store: is the Cache API bound, and does the key stay the same between requests?)"
      : "";
  return {
    percent,
    problems: [
      `the hit ratio is ${String(percent)} percent over ${String(values.length)} GETs, at least ${String(HIT_RATIO * 100)} percent is required${hint}`,
    ],
  };
}

async function edge(context: Context, fixture: string | undefined): Promise<ModeResult> {
  if (fixture !== undefined) {
    const ratio = ratioOf(labels.parse(JSON.parse(readFileSync(fixture, "utf8"))));
    return {
      detail: `edge hit ratio ${String(ratio.percent)}% ok (recorded list ${fixture})`,
      problems: ratio.problems,
    };
  }
  const { base } = context;
  const problems = tally();
  const targets = await discover(base);
  const paths = [...targets.pages, ...targets.json];
  const unknown = `/api/public/stories/h1-probe-${Date.now().toString(36)}`;
  const pair = [label(await send(base, unknown)), label(await send(base, unknown))];
  if (pair[0] !== "miss" || pair[1] !== "hit")
    problems.add(`a new key answered ${pair.join(" then ")}, expected miss then hit`);
  for (const path of paths) {
    const reply = await send(base, path);
    if (!reply.headers.has("x-catalog-version")) problems.add(`${path} has no x-catalog-version`);
  }
  const seen: string[] = [];
  await pool(context.requests, CONCURRENCY, async (index) => {
    const path = paths[index % paths.length] ?? "/";
    const reply = await send(base, path);
    seen.push(label(reply));
    if (!reply.headers.has("x-mop-cache")) problems.add(`${path} has no x-mop-cache`);
  });
  for (const path of ["/", "/api/public/properties"]) {
    const query = label(await send(base, `${path}?h1=${Math.random().toString(36).slice(2)}`));
    if (query !== "hit")
      problems.add(`${path} with a random query string answered ${query}, expected hit`);
  }
  for (const path of ["/api/admin/me", "/admin", "/api/public/nothing-here"]) {
    for (let round = 0; round < 2; round += 1) {
      const answer = label(await send(base, path));
      if (answer === "hit") problems.add(`${path} (no-store) was served as a hit`);
    }
  }
  const ratio = ratioOf(seen);
  const list = [...problems.list(), ...ratio.problems];
  return {
    detail: `edge hit ratio ${String(ratio.percent)}% ok (${String(context.requests)} GETs over ${String(paths.length)} paths after one warm-up pass)`,
    problems: list,
  };
}

async function keepwarm(context: Context): Promise<ModeResult> {
  const problems = tally();
  const warm = await send(context.base, "/");
  if (warm.status !== 200) problems.add(`/ answered ${String(warm.status)} before the tick`);
  await pause(MEMO_MS + 1000);
  const db = await quietDb(context);
  const before = await statements(db);
  const tick = await send(context.base, SCHEDULED);
  const after = await statements(db);
  if (tick.status !== 200)
    problems.add(
      `${SCHEDULED} answered ${String(tick.status)}; start the Worker with --test-scheduled`,
    );
  const counts = between(before, after);
  const state = counts.get(STATE) ?? 0;
  if (state !== 1)
    problems.add(`the tick ran public_state ${String(state)} times, expected exactly 1`);
  for (const stray of strays(counts, new Set([STATE]))) problems.add(`the tick ran ${stray}`);
  const page = await send(context.base, "/");
  if (label(page) !== "hit") problems.add(`/ after the tick answered ${label(page)}, expected hit`);
  const extra = between(after, await statements(db)).get(STATE) ?? 0;
  if (extra > 0)
    problems.add(
      `/ after the tick ran public_state ${String(extra)} times, the tick left the memo warm`,
    );
  return {
    detail: "the tick ran public_state once after the memo expired and / is still a hit",
    problems: problems.list(),
  };
}

async function twice(run: () => Promise<ModeResult>): Promise<ModeResult> {
  const first = await run();
  if (first.problems.length === 0) return first;
  console.error(
    `cache: ran again because the database is shared, the first run found ${first.problems.join("; ")}`,
  );
  return run();
}

async function runMode(
  mode: Mode,
  context: Context,
  fixture: string | undefined,
): Promise<ModeResult> {
  switch (mode) {
    case "memory":
      return twice(() => memory(context));
    case "identical":
      return identical(context);
    case "never":
      return never(context);
    case "writes":
      return twice(() => writes(context));
    case "edge":
      return edge(context, fixture);
    case "keepwarm":
      return twice(() => keepwarm(context));
  }
}

function parseModes(text: string): Mode[] | undefined {
  const wanted = text.split(",").map((name) => name.trim());
  const modes = MODES.filter((mode) => wanted.includes(mode));
  return modes.length === wanted.length && wanted.length > 0 ? modes : undefined;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mode: { type: "string" }, fixture: { type: "string" } },
  });
  const [base, countText] = positionals;
  const modes = values.mode === undefined ? undefined : parseModes(values.mode);
  const requests = countText === undefined ? EDGE_REQUESTS : Number(countText);
  const offline = values.fixture !== undefined && modes?.length === 1 && modes[0] === "edge";
  if (
    modes === undefined ||
    !Number.isInteger(requests) ||
    requests < 1 ||
    (!offline && (base === undefined || !URL.canParse(base))) ||
    (values.fixture !== undefined && !offline)
  ) {
    console.error(
      `usage: bun run scripts/harden/cache-probe.ts --mode ${MODES.join(",")} <baseUrl> [n]\n       bun run scripts/harden/cache-probe.ts --mode edge --fixture <file>`,
    );
    return 64;
  }
  const counting = modes.some((mode) => COUNTING.has(mode));
  const dbUrl = process.env["DEV_DB_URL"];
  if (counting) await assertNotProduction({ dbUrl });
  let db: ProbeDb | undefined;
  let unavailable = "";
  if (counting) {
    try {
      db = await openProbeDb(dbUrl ?? "", LOCK_WAIT_MS);
    } catch (error) {
      if (!(error instanceof LockBusy)) throw error;
      unavailable = error.message;
    }
  }
  let failed = false;
  try {
    for (const mode of modes) {
      try {
        const result = await runMode(
          mode,
          { base: base ?? "", requests, db, unavailable },
          values.fixture,
        );
        for (const problem of result.problems) console.error(`cache ${mode}: ${problem}`);
        if (result.problems.length === 0) console.log(`cache ${mode} ok (${result.detail})`);
        failed ||= result.problems.length > 0;
      } catch (error) {
        if (!(error instanceof Busy)) throw error;
        console.log(`BLOCKED cache ${mode} counts statements and ${error.message}; run it again`);
      }
    }
  } finally {
    await db?.close();
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
