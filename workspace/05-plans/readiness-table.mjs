// Rebuilds the "Start readiness" table of PLAN.md from the plans themselves, so it cannot go stale.
// Usage: node workspace/05-plans/readiness-table.mjs [--write]
// A step counts as waiting when its numbered line in "## Steps" says BLOCKED. The reasons are matched by keyword.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const order = ["B1b", "B2", "B3", "B3b", "B4", "B5", "B6", "B7", "B8", "B8b", "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16", "B17", "H1", "L1"];
const have = readdirSync(here).filter((f) => /^(B|H|L)\S*\.md$/.test(f)).map((f) => f.replace(".md", ""));
for (const p of have) if (!order.includes(p)) order.push(p);

const reasons = [
  ["R2 switched on", /\bR2\b[^.]{0,80}\b(on|enabled|switch|bucket)|until R2|R2 is (on|off)|E8/i],
  ["Resend live step (deployed endpoint or the production key at L1; the account exists, E17)", /resend/i],
  ["mop-prod (created at launch)", /mop-prod/i],
  ["Anthropic API key", /anthropic/i],
  ["X developer app", /\bX (developer|app|account|API)\b|X_CLIENT|post_x/],
  ["LinkedIn page and app", /linkedin/i],
  ["Meta app (partner)", /\bmeta\b|instagram/i],
  ["Google accounts", /google|GA4|search console/i],
  ["Omnikom endpoint", /omnikom (endpoint|url|supplies|webhook)/i],
  ["legal entity and payment facts", /legal entity|payment (method|fact|instruction)|owner inputs|invoice design/i],
  ["GitHub dispatch token", /GITHUB_DISPATCH_TOKEN|dispatch token|fine-grained/i],
  ["CEO creative pick", /creative pick|picked one option|contact sheets?|CEO (has )?pick/i],
  ["invoice design approval", /invoice (design|template)[^.]{0,60}approv|approv[^.]{0,60}invoice (design|template)/i],
  ["custom domain (L1)", /custom domain|domain attach|Stage 5|step 4e/i],
  ["GitHub Pro (branch protection)", /github pro/i],
];

const rows = [];
let r2 = 0;
for (const p of order) {
  const text = readFileSync(join(here, `${p}.md`), "utf8");
  const steps = (text.split(/^## Steps/m)[1] || "").split(/^## /m)[0].split("\n").filter((l) => /^\d+[a-z]?\. /.test(l));
  const blocked = steps.filter((l) => /BLOCKED/.test(l));
  const why = new Set();
  for (const l of blocked) {
    for (const seg of l.split(/BLOCKED/).slice(1)) for (const [name, re] of reasons) if (re.test(seg.slice(0, 400))) why.add(name);
  }
  if (why.has("R2 switched on")) r2++;
  rows.push(`| ${p} | ${blocked.length ? `${blocked.length} of ${steps.length}` : `none of ${steps.length}`} | ${[...why].join(", ") || (blocked.length ? "see the plan" : "none")} |`);
}
const table = ["| Slice | Steps with a waiting part | On what |", "|---|---|---|", ...rows].join("\n");
if (process.argv.includes("--write")) {
  const planPath = join(here, "PLAN.md");
  let plan = readFileSync(planPath, "utf8");
  const start = plan.indexOf("| Slice | Steps");
  const end = plan.indexOf("\n\n", start);
  if (start < 0 || end < 0) throw new Error("readiness table not found in PLAN.md");
  plan = plan.slice(0, start) + table + plan.slice(end);
  plan = plan.replace(/switch R2 on \(\d+ slices have a\s+waiting step\)/, `switch R2 on (${r2} slices have a waiting step)`);
  writeFileSync(planPath, plan);
  console.log(`PLAN.md table rewritten (${rows.length} rows, R2 in ${r2})`);
} else console.log(table);
