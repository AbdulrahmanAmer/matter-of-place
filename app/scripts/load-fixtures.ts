// `bun run fixtures:load [-- --reset]` (B4 step 8, GQ-03): commits the deterministic data set to the database of
// DEV_DB_URL in one transaction, after the production guard (invariant 4, ruling H35 (5)) and under the writer lock
// (G34). It is idempotent; `--reset` removes every fixture row first, in the same transaction.
import { commitDataset, formatCounts } from "../tests/fixtures/dataset";
import { holdDevLock } from "../tests/fixtures/dev-lock";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const unknown = args.filter((arg) => arg !== "--reset");
if (unknown.length > 0) throw new Error(`fixtures:load: unknown arguments ${unknown.join(" ")}`);

await assertNotProduction();
const release = await holdDevLock();
try {
  const counts = await commitDataset({ reset: args.includes("--reset") });
  process.stdout.write(`${formatCounts(counts)}\n`);
} finally {
  await release();
}
