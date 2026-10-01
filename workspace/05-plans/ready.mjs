// Readiness gate: can the build slices start on this machine, today?
// Usage: node workspace/05-plans/ready.mjs [--full]     (--full also runs `bun run check` and `bun run build`)
// Prints one line per check: PASS, FAIL (stops the build) or WAIT (an operator input that blocks named slices only).
// Never prints a secret value. Exit 0 when nothing is FAIL.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const APP = join(ROOT, "Matter Of Place Codebase");
const REPO = "AbdulrahmanAmer/matter-of-place";
const full = process.argv.includes("--full");
const rows = [];
const add = (state, name, detail = "") => rows.push({ state, name, detail });
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: ROOT, shell: false, ...opts });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), missing: Boolean(r.error) };
};
const firstLine = (s) => (s.split(/\r?\n/).find((l) => l.trim()) || "").trim().slice(0, 60);

// 1. tools (no Docker: S50)
for (const [cmd, args] of [["node", ["--version"]], ["bun", ["--version"]], ["git", ["--version"]], ["gh", ["--version"]], ["supabase", ["--version"]], ["psql", ["--version"]], ["pg_dump", ["--version"]], ["ffmpeg", ["-version"]]]) {
  const r = run(cmd, args);
  add(r.missing || r.code !== 0 ? "FAIL" : "PASS", `tool ${cmd}`, r.missing ? "not found" : firstLine(r.out));
}

// 2. local secrets file
const envPath = join(ROOT, ".env");
let env = {};
if (!existsSync(envPath)) add("FAIL", ".env", "missing");
else {
  env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const need = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SENTRY_DSN", "SUPABASE_ACCESS_TOKEN", "DEV_SUPABASE_PROJECT_REF", "DEV_SUPABASE_DB_PASSWORD", "DEV_SUPABASE_SERVICE_ROLE_KEY", "DEV_SUPABASE_POOLER_HOST", "DEV_SUPABASE_POOLER_USER", "PROD_TURNSTILE_SECRET", "VITE_TURNSTILE_SITE_KEY_PROD", "PREVIEW_RATE_LIMIT_SALT", "PREVIEW_SENTRY_TEST_TOKEN"];
  const bad = need.filter((k) => !env[k] || env[k].startsWith("PASTE_"));
  add(bad.length ? "FAIL" : "PASS", ".env names", bad.length ? `missing: ${bad.join(", ")}` : `${need.length} present`);
  const ig = run("git", ["check-ignore", "-q", ".env"]);
  const tracked = run("git", ["ls-files", ".env", "creds", "cloudflare tokens and secrets.txt"]);
  add(ig.code === 0 && !tracked.out.trim() ? "PASS" : "FAIL", "secrets files ignored by git", tracked.out.trim() ? "a secrets file is tracked" : "");
}

// 3. Cloudflare
const cfBase = `https://api.cloudflare.com/client/v4`;
const cf = async (path) => {
  try {
    const r = await fetch(cfBase + path, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    return await r.json();
  } catch (e) {
    return { success: false, errors: [{ message: String(e.message || e) }] };
  }
};
const acct = env.CLOUDFLARE_ACCOUNT_ID;
if (env.CLOUDFLARE_API_TOKEN && acct) {
  const v = await cf(`/accounts/${acct}/tokens/verify`);
  add(v.success && v.result?.status === "active" ? "PASS" : "FAIL", "Cloudflare admin token", v.result?.status || v.errors?.[0]?.message);
  const toks = await cf(`/accounts/${acct}/tokens?per_page=50`);
  const ci = (toks.result || []).find((t) => t.name === "mop-github-actions");
  const perms = ci ? ci.policies.flatMap((p) => p.permission_groups.map((g) => g.name)).sort() : [];
  const want = ["Workers KV Storage Read", "Workers R2 Storage Write", "Workers Scripts Write"];
  add(ci && ci.status === "active" && want.every((w) => perms.includes(w)) ? "PASS" : "FAIL", "Cloudflare deploy token mop-github-actions", ci ? perms.join(", ") : "not found");
  const z = await cf(`/zones?name=matterofplace.com`);
  add(z.result?.[0]?.status === "active" ? "PASS" : "FAIL", "zone matterofplace.com", z.result?.[0]?.status);
  const sub = await cf(`/accounts/${acct}/workers/subdomain`);
  add(sub.success ? "PASS" : "FAIL", "workers.dev subdomain", sub.result?.subdomain || sub.errors?.[0]?.message);
  const w = await cf(`/accounts/${acct}/challenges/widgets`);
  add((w.result || []).some((x) => x.domains.includes("matterofplace.com")) ? "PASS" : "FAIL", "Turnstile widget", (w.result || []).map((x) => x.name).join(", "));
  const r2 = await cf(`/accounts/${acct}/r2/buckets`);
  add(r2.success ? "PASS" : "WAIT", "R2 storage", r2.success ? "enabled" : "off by the operator's decision (S50): blocks B1b step 8, media variants, reels, backups");
}

// 4. Supabase
if (env.SUPABASE_ACCESS_TOKEN) {
  try {
    const r = await fetch("https://api.supabase.com/v1/projects", { headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
    const j = await r.json();
    const dev = Array.isArray(j) ? j.find((p) => p.id === env.DEV_SUPABASE_PROJECT_REF) : null;
    add(dev?.status === "ACTIVE_HEALTHY" ? "PASS" : "FAIL", "Supabase access token and mop-dev", dev ? `${dev.name} ${dev.status}` : `http ${r.status}`);
    add(Array.isArray(j) && j.some((p) => p.name === "mop-prod") ? "PASS" : "WAIT", "Supabase mop-prod", "created at launch: blocks L1 and the production deploy job's db push");
  } catch (e) {
    add("FAIL", "Supabase access token and mop-dev", String(e.message || e));
  }
  const q = run("psql", ["-h", env.DEV_SUPABASE_POOLER_HOST, "-p", "5432", "-U", env.DEV_SUPABASE_POOLER_USER, "-d", "postgres", "-Atc", "select current_setting('server_version')"], {
    env: { ...process.env, PGPASSWORD: env.DEV_SUPABASE_DB_PASSWORD, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "15" },
  });
  add(q.code === 0 ? "PASS" : "FAIL", "database password through the pooler", q.code === 0 ? `server ${firstLine(q.out)}` : firstLine(q.out.replace(env.DEV_SUPABASE_DB_PASSWORD, "***")));
}

// 5. Sentry DSN shape
add(/^https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+$/.test(env.SENTRY_DSN || "") ? "PASS" : "FAIL", "Sentry DSN", "format");

// 6. GitHub
const gs = run("gh", ["secret", "list", "--repo", REPO]);
const haveSecrets = gs.out.split(/\r?\n/).map((l) => l.split(/\s+/)[0]).filter(Boolean);
const needSecrets = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SUPABASE_ACCESS_TOKEN", "DEV_SUPABASE_PROJECT_REF", "DEV_SUPABASE_DB_PASSWORD", "PREVIEW_WORKER_SECRETS_JSON"];
const missSecrets = needSecrets.filter((s) => !haveSecrets.includes(s));
add(gs.code === 0 && !missSecrets.length ? "PASS" : "FAIL", "GitHub Actions secrets", missSecrets.length ? `missing: ${missSecrets.join(", ")}` : `${needSecrets.length} present`);
const gv = run("gh", ["variable", "list", "--repo", REPO]);
add(/VITE_SITE_URL/.test(gv.out) && /VITE_TURNSTILE_SITE_KEY/.test(gv.out) ? "PASS" : "FAIL", "GitHub variables", "VITE_SITE_URL, VITE_TURNSTILE_SITE_KEY");
const ga = run("gh", ["api", `repos/${REPO}/actions/permissions`, "--jq", ".enabled"]);
add(ga.out.trim() === "true" ? "PASS" : "FAIL", "GitHub Actions enabled");

// 7. repository state
const branch = run("git", ["branch", "--show-current"]).out.trim();
add(branch === "main" ? "PASS" : "FAIL", "on branch main", branch);
const dirty = run("git", ["status", "--porcelain"]).out.split(/\r?\n/).filter((l) => l.trim() && !l.includes("matter-of-place-for-partners.pptx"));
add(dirty.length ? "FAIL" : "PASS", "working tree clean", dirty.length ? `${dirty.length} uncommitted paths` : "");
run("git", ["fetch", "-q", "origin", "main"]);
const ahead = run("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"]).out.trim();
add(ahead === "0\t0" ? "PASS" : "FAIL", "in sync with origin/main", ahead.replace("\t", " behind, ") + " ahead");

// 8. plans, agents, harness
const cp = run("node", [join(here, "check-plans.mjs")]);
add(cp.code === 0 ? "PASS" : "FAIL", "check-plans", cp.out.trim().split(/\r?\n/).pop());
for (const f of [".claude/agents/mop-builder.md", ".claude/agents/mop-designer.md", ".claude/agents/mop-scout.md", ".claude/agents/mop-auditor.md", ".claude/workflows/build-slice.js", "workspace/05-plans/RUNBOOK.md", "GOTCHAS.md", "PROJECT-STATE.md", ".claude/POSITION.md"]) {
  add(existsSync(join(ROOT, f)) ? "PASS" : "FAIL", `file ${f}`);
}
const stage = (readFileSync(join(ROOT, "PROJECT-STATE.md"), "utf8").match(/^STAGE:\s*(\d+)/m) || [])[1];
add(stage === "3" ? "PASS" : "FAIL", "PROJECT-STATE stage 3 (BUILD)", `stage ${stage}`);

// 9. the app itself
if (full) {
  const c = run("bun", ["run", "check"], { cwd: APP });
  add(c.code === 0 ? "PASS" : "FAIL", "bun run check", c.out.trim().split(/\r?\n/).filter((l) => /Tests|error/i.test(l)).pop() || "");
  const b = run("bun", ["run", "build"], { cwd: APP });
  add(b.code === 0 && existsSync(join(APP, ".output", "server", "wrangler.json")) ? "PASS" : "FAIL", "bun run build");
} else add("WAIT", "bun run check and build", "skipped: pass --full");

// 10. operator inputs that block named slices only
const waits = [
  ["RESEND_API_KEY", "Resend account and API key", "B5 email, B11 newsletter"],
  ["ANTHROPIC_API_KEY", "Anthropic API key", "B9 write_captions"],
  ["X_CLIENT_ID", "X developer app", "B10 post_x"],
  ["LINKEDIN_CLIENT_ID", "LinkedIn company page and app", "B10 post_linkedin"],
  ["META_APP_SECRET", "Meta app through the partner", "B10 post_meta"],
  ["GA4_MEASUREMENT_ID", "Google Analytics and Search Console", "B13, B14"],
  ["OMNIKOM_WEBHOOK_URL", "Omnikom endpoint and secret", "B15 step 7"],
  ["UPTIME_API_KEY", "uptime monitor account", "B14, H1, L1"],
  ["SENTRY_AUTH_TOKEN", "Sentry user token (org:read, project:read, event:read)", "the stored-event checks of B1b step 4, H1 and L1"],
  ["GITHUB_DISPATCH_TOKEN", "fine-grained GitHub token for render dispatch", "B8 step 7, B9 renders in Actions"],
  ["LEGAL_ENTITY_NAME", "Omnikom legal entity, address, payment methods", "B6 invoice issue, B16"],
];
for (const [key, what, blocks] of waits) add(env[key] ? "PASS" : "WAIT", what, env[key] ? "" : `blocks ${blocks}`);

const pad = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.state}  ${r.name.padEnd(pad)}  ${r.detail || ""}`.trimEnd());
const fails = rows.filter((r) => r.state === "FAIL").length;
const waitsN = rows.filter((r) => r.state === "WAIT").length;
console.log(`\nREADY TO BUILD: ${fails ? "no" : "yes"} (${rows.filter((r) => r.state === "PASS").length} pass, ${fails} fail, ${waitsN} waiting on the operator)`);
// --launch (L1's one gate for operator inputs, ASSUMED G32): nothing may be waiting either
if (process.argv.includes("--launch")) {
  console.log(`READY TO LAUNCH: ${fails || waitsN ? "no" : "yes"}${waitsN ? ` (${waitsN} operator input(s) still missing, listed above as WAIT)` : ""}`);
  process.exit(fails || waitsN ? 1 : 0);
}
process.exit(fails ? 1 : 0);
