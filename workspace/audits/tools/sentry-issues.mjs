// Read-only view of the Sentry project's errors, with the read-only token SENTRY_AUTH_TOKEN (mop-readonly, G11).
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs [days] [limit]   unresolved issues, most frequent first
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs event <issueId>    the latest event of one issue
// Each line: count, level, where the event came from (deployed Worker, Edge Function, or a local build path, which
// is a test run on a laptop), last seen, title. Never prints the token.
const org = process.env["SENTRY_ORG"];
const token = process.env["SENTRY_AUTH_TOKEN"];
if (!org || !token) {
  console.error(
    "sentry-issues: SENTRY_ORG and SENTRY_AUTH_TOKEN must be set in .env",
  );
  process.exit(2);
}

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
const get = async (path) => {
  const answer = await fetch(`https://sentry.io/api/0${path}`, {
    headers: { Authorization: `Bearer ${String(token)}` },
  });
  if (!answer.ok) {
    console.error(
      `sentry-issues: ${path.split("?")[0] ?? path} answered ${String(answer.status)}`,
    );
    process.exit(1);
  }
  return answer.json();
};

/**
 * @param {string} culprit
 * @returns {string}
 */
const origin = (culprit) =>
  /(^|\()[A-Z]:\/|\/mop-build\//.test(culprit)
    ? "local test build"
    : /sb-compile-edge-runtime/.test(culprit)
      ? "job runner"
      : "deployed Worker";

/**
 * @param {any} event
 * @param {string} key
 * @returns {string}
 */
const tag = (event, key) => {
  /** @type {{ key: string, value: string }[]} */
  const tags = Array.isArray(event.tags) ? event.tags : [];
  return tags.find((t) => t.key === key)?.value ?? "none";
};

const [first, second] = process.argv.slice(2);
if (first === "event") {
  const event = await get(
    `/organizations/${String(org)}/issues/${String(second)}/events/latest/`,
  );
  /** @type {any[]} */
  const entries = Array.isArray(event.entries) ? event.entries : [];
  /** @type {any[]} */
  const frames = entries
    .flatMap((/** @type {any} */ e) => e.data?.values ?? [])
    .flatMap((/** @type {any} */ v) => v.stacktrace?.frames ?? [])
    .slice(-6);
  console.log(
    `${String(event.title)}\nwhen ${String(event.dateCreated)}\nenvironment ${tag(event, "environment")}\nurl ${tag(event, "url")}`,
  );
  for (const f of frames)
    console.log(
      `  at ${String(f.function ?? "?")} (${String(f.filename)}:${String(f.lineNo)})`,
    );
} else {
  const days = Number(first) || 14;
  const limit = Number(second) || 50;
  /** @type {any[]} */
  const issues = await get(
    `/organizations/${String(org)}/issues/?query=is:unresolved&statsPeriod=${String(days)}d&sort=freq&limit=${String(limit)}`,
  );
  console.log(
    `unresolved issues, last ${String(days)} days: ${String(issues.length)}`,
  );
  for (const i of issues) {
    console.log(
      `${String(i.id)} | ${String(i.count)}x | ${String(i.level)} | ${origin(String(i.culprit ?? ""))} | last ${String(i.lastSeen).slice(0, 16)} | ${String(i.title).slice(0, 120)}`,
    );
  }
}
