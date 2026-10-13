// node .claude/hooks/edit-impact.test.mjs: each case is one of the failures of 2026-10-13 the hook must have caught.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expectedTitle, exportedNames, findings } from "./edit-impact.mjs";

const root = resolve("E:/repo");
const at = (p) => resolve(root, p);
const cases = [];
const it = (name, fn) => cases.push([name, fn]);
const run = (over) =>
  findings({ root, headText: null, sources: [], registries: [], text: "", file: at("app/src/x.ts"), ...over });

it("flags an entry whose find no longer occurs once (b17-cn-modified: the footer check written twice)", () => {
  const check = "event.button !== 0 || event.ctrlKey";
  const lines = run({
    file: at("app/src/components/layout/footer.tsx"),
    text: `a(${check});\nb(${check});`,
    registries: [{ name: "B17", entries: [{ id: "b17-cn-modified", file: "src/components/layout/footer.tsx", find: check, test: "t" }] }],
  });
  assert.ok(lines.some((l) => l.startsWith("STALE B17:b17-cn-modified") && l.includes("2 times")), lines.join("\n"));
});

it("flags an expect that names a renamed test (ak-a after the session test was renamed)", () => {
  const lines = run({
    file: at("app/tests/unit/session-local.test.ts"),
    text: 'it("hands out only the Auth half of its client", () => {});',
    registries: [{ name: "fix-auth-client", entries: [{ id: "ak-a", test: "tests/unit/session-local.test.ts", expect: "× .*hands out only the Auth half of the service-key client", file: "x", find: "y" }] }],
  });
  assert.ok(lines.some((l) => l.startsWith("EXPECT fix-auth-client:ak-a")), lines.join("\n"));
});

it("flags a new test file no entry names (deploy-local.test.ts)", () => {
  const lines = run({ file: at("app/tests/unit/deploy-local.test.ts"), text: 'it("x", () => {});' });
  assert.ok(lines.some((l) => l.startsWith("NO ENTRY")), lines.join("\n"));
});

it("flags an export that left the file while a test still imports it (openAccess moved to access-events)", () => {
  const lines = run({
    file: at("app/src/lib/access.ts"),
    headText: "export function openAccess() {}\nexport const KEY = 1;",
    text: "export const KEY = 1;",
    sources: [
      { path: at("app/tests/unit/access-panel.test.tsx"), text: 'import { openAccess, KEY } from "../../src/lib/access";' },
    ],
  });
  assert.ok(lines.some((l) => l.startsWith("GONE openAccess") && l.includes("access-panel.test.tsx")), lines.join("\n"));
});

it("flags an export nothing else uses (knip: activitySchema)", () => {
  const lines = run({
    file: at("app/src/domain/workforce.ts"),
    text: "export const activitySchema = 1;\nexport const officeSchema = activitySchema;",
    sources: [{ path: at("app/src/server/x.ts"), text: 'import { officeSchema } from "../domain/workforce";' }],
  });
  assert.ok(lines.some((l) => l.startsWith("UNUSED export activitySchema")), lines.join("\n"));
  assert.ok(!lines.some((l) => l.includes("officeSchema in")), lines.join("\n"));
});

it("names the companion of .env.example (runbook-lint) and of a new table (the RLS seed row)", () => {
  assert.ok(run({ file: at("app/.env.example"), text: "X=" }).some((l) => l.includes("rotation.md")));
  assert.ok(run({ file: at("app/supabase/migrations/1_x.sql"), text: "create table public.t (id int);" }).some((l) => l.includes("rls.db.test.ts")));
});

it("reads export names and expected titles", () => {
  assert.deepEqual([...exportedNames("export function a() {}\nexport type B = 1;\nexport { c, d as e } from './x';")], ["a", "B", "c", "e"]);
  assert.equal(expectedTitle("× .*refuses a log of another head or with a failed step"), "refuses a log of another head or with a failed step");
  assert.equal(expectedTitle("× .*from the footer link and from Alt \\+ A"), "from the footer link and from Alt + A");
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
