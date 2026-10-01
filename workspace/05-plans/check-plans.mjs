// Cross-checks the slice plans against the architecture (GOTCHAS P-031). Usage: node workspace/05-plans/check-plans.mjs
// Fails (exit 1) on: a backticked event name not in the architecture catalog; a step-like name not in the 14-step
// catalog; the B8b recipe seed missing a catalog event; a plan missing one of the eight sections; leftover
// "Gap additions" appendices; CRLF bytes. Prints double-creator candidates as warnings (paths listed under Files
// with create/new/add wording in more than one plan) for a human to judge.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arch = readFileSync(join(here, "..", "06-architecture", "architecture.md"), "utf8");
const catLine = arch.match(/the event catalog \((\d+)\): ([^\n]*)/);
const events = new Set([...catLine[2].matchAll(/`([a-z_.]+)`/g)].map((m) => m[1]));
const steps = new Set(["send_email","render_variants","render_cover","render_carousel","render_story","render_reel","write_captions","build_newsletter_block","post_meta","queue_digest","notify_admin","webhook_omnikom","bump_catalog_version","purge_cache","render_og_static","post_x","post_linkedin"]);
const sections = ["## Goal","## Contract","## Files","## Data changes","## Steps","## Verification","## Risks","## Out of scope"];
const plans = readdirSync(here).filter((f) => /^(B|H|L)\S*\.md$/.test(f));
const errors = [], warnings = [], created = {};
// names that look like events but are functions, files, audit actions or columns; reviewed 2026-10-01
const allow = new Set(["submission.decline","submission.accept","property.publish","asset.auto_approve","subscriber.repermission","subscriber.drop_inactive","payment.waived"]);

for (const f of plans) {
  const raw = readFileSync(join(here, f));
  if (raw.includes("\r")) errors.push(`${f}: CRLF bytes (G-008)`);
  const s = raw.toString("utf8");
  for (const h of sections) if (!s.split("\n").some((l) => l.startsWith(h))) errors.push(`${f}: missing section ${h}`);
  if (s.includes("## Gap additions")) errors.push(`${f}: leftover Gap additions appendix (P-030: fold into sections)`);
  for (const m of s.matchAll(/`((?:submission|invoice|payment|property|asset|digest|inquiry|subscriber|health)\.[a-z_]+)`/g))
    if (!events.has(m[1]) && !allow.has(m[1]) && !/\.(ts|tsx|json|spec|test|fixture|example|pdf|sql|mjs)$/.test(m[1])) errors.push(`${f}: event \`${m[1]}\` is not in the catalog (${events.size} events)`);
  for (const m of s.matchAll(/(\[?)`((?:render|post|queue|notify|webhook|bump|purge)_[a-z_]+)`/g))
    if (m[1] !== "[" && !steps.has(m[2]) && ![...steps].some((st) => m[2].startsWith(st + "_")) && !/_(error|receipts|at|by|id|status|count|add)$/.test(m[2])) errors.push(`${f}: step \`${m[2]}\` is not in the step catalog`);
  const filesSec = (s.split(/^## Files/m)[1] || "").split(/^## /m)[0];
  for (const m of filesSec.matchAll(/`((?:src|supabase|scripts|tests|\.github|docs|wrangler|public)[^`\s]*\.[a-z]+)`[^\n]*/g))
    if (/\b(create|new)\b/i.test(m[0]) && !/\b(change|edit|extend|modify|update|add)\b/i.test(m[0])) (created[m[1]] ??= new Set()).add(f);
}
const seed = readFileSync(join(here, "B8b.md"), "utf8");
for (const e of events) if (!seed.includes("`" + e + "`")) errors.push(`B8b.md: recipe seed has no row for \`${e}\``);
for (const [p, fs] of Object.entries(created)) if (fs.size > 1) warnings.push(`created by more than one plan: ${p} ← ${[...fs].join(", ")}`);

for (const w of warnings) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `check-plans: ${errors.length} error(s)` : `check-plans: OK (${plans.length} plans, ${events.size} events, ${steps.size} steps)`);
process.exit(errors.length ? 1 : 0);
