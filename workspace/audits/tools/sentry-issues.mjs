// Read-only view of the Sentry project's errors, with the read-only token SENTRY_AUTH_TOKEN (mop-readonly, G11).
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs [days] [limit]   unresolved issues, most frequent first
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs event <issueId>    the latest event of one issue
// Each line: count, level, where the event came from (deployed Worker, job runner, or a local build path, which is a
// test run on a laptop), last seen, title. Never prints the token.
import { field, recordsOf } from "./common.mjs";

const org = process.env["SENTRY_ORG"] ?? "";
const token = process.env["SENTRY_AUTH_TOKEN"] ?? "";
if (!org || !token) {
  process.stderr.write("sentry-issues: SENTRY_ORG and SENTRY_AUTH_TOKEN must be set in .env\n");
  process.exit(2);
}

/** @param {unknown} value */
const str = (value) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function get(path) {
  const answer = await fetch(`https://sentry.io/api/0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!answer.ok) {
    process.stderr.write(
      `sentry-issues: ${path.split("?")[0] ?? path} answered ${String(answer.status)}\n`,
    );
    process.exit(1);
  }
  return /** @type {unknown} */ (await answer.json());
}

/** @param {string} culprit */
const origin = (culprit) =>
  /(^|\()[A-Z]:\/|\/mop-build\//.test(culprit)
    ? "local test build"
    : /sb-compile-edge-runtime/.test(culprit)
      ? "job runner"
      : "deployed Worker";

/**
 * @param {unknown} event
 * @param {string} key
 */
const tag = (event, key) =>
  str(
    field(
      recordsOf(field(event, "tags")).find((t) => field(t, "key") === key),
      "value",
    ),
  ) || "none";

const [first = "", second = ""] = process.argv.slice(2);
if (first === "event") {
  const event = await get(`/organizations/${org}/issues/${second}/events/latest/`);
  const frames = recordsOf(field(event, "entries"))
    .flatMap((entry) => recordsOf(field(field(entry, "data"), "values")))
    .flatMap((value) => recordsOf(field(field(value, "stacktrace"), "frames")))
    .slice(-6);
  process.stdout.write(
    `${str(field(event, "title"))}\nwhen ${str(field(event, "dateCreated"))}\nenvironment ${tag(event, "environment")}\nurl ${tag(event, "url")}\n`,
  );
  for (const f of frames) {
    process.stdout.write(
      `  at ${str(field(f, "function")) || "?"} (${str(field(f, "filename"))}:${str(field(f, "lineNo"))})\n`,
    );
  }
} else {
  const days = Number(first) || 14;
  const limit = Number(second) || 50;
  const issues = recordsOf(
    await get(
      `/organizations/${org}/issues/?query=is:unresolved&statsPeriod=${String(days)}d&sort=freq&limit=${String(limit)}`,
    ),
  );
  process.stdout.write(`unresolved issues, last ${String(days)} days: ${String(issues.length)}\n`);
  for (const i of issues) {
    process.stdout.write(
      `${str(field(i, "id"))} | ${str(field(i, "count"))}x | ${str(field(i, "level"))} | ${origin(str(field(i, "culprit")))} | last ${str(field(i, "lastSeen")).slice(0, 16)} | ${str(field(i, "title")).slice(0, 120)}\n`,
    );
  }
}
