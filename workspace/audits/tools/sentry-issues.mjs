// Read-only view of the Sentry project's errors, with the read-only token SENTRY_AUTH_TOKEN (mop-readonly, G11).
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs [days] [limit]   unresolved issues, most frequent first
//   node --env-file=.env workspace/audits/tools/sentry-issues.mjs event <issueId>    the latest event of one issue
// Each line: count, level, where the event came from (deployed Worker, Edge Function, or a local build path, which
// is a test run on a laptop), last seen, title. Never prints the token.
const org = process.env.SENTRY_ORG;
const token = process.env.SENTRY_AUTH_TOKEN;
if (!org || !token) {
  console.error("sentry-issues: SENTRY_ORG and SENTRY_AUTH_TOKEN must be set in .env");
  process.exit(2);
}
const get = async (path) => {
  const answer = await fetch(`https://sentry.io/api/0${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!answer.ok) {
    console.error(`sentry-issues: ${path.split("?")[0]} answered ${answer.status}`);
    process.exit(1);
  }
  return answer.json();
};
const origin = (culprit) =>
  /(^|\()[A-Z]:\/|\/mop-build\//.test(culprit) ? "local test build" : /sb-compile-edge-runtime/.test(culprit) ? "job runner" : "deployed Worker";

const [first, second] = process.argv.slice(2);
if (first === "event") {
  const event = await get(`/organizations/${org}/issues/${second}/events/latest/`);
  const frames = (event.entries ?? []).flatMap((e) => e.data?.values ?? []).flatMap((v) => v.stacktrace?.frames ?? []).slice(-6);
  console.log(`${event.title}\nwhen ${event.dateCreated}\nenvironment ${event.tags?.find((t) => t.key === "environment")?.value ?? "none"}\nurl ${event.tags?.find((t) => t.key === "url")?.value ?? "none"}`);
  for (const f of frames) console.log(`  at ${f.function ?? "?"} (${f.filename}:${f.lineNo})`);
} else {
  const days = Number(first) || 14;
  const limit = Number(second) || 50;
  const issues = await get(`/organizations/${org}/issues/?query=is:unresolved&statsPeriod=${days}d&sort=freq&limit=${limit}`);
  console.log(`unresolved issues, last ${days} days: ${issues.length}`);
  for (const i of issues) {
    console.log(`${i.id} | ${i.count}x | ${i.level} | ${origin(i.culprit ?? "")} | last ${i.lastSeen.slice(0, 16)} | ${i.title.slice(0, 120)}`);
  }
}
