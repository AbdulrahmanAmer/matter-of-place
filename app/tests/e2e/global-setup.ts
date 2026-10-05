// Playwright's global setup (B4 steps 5 and 8). Without E2E_DATASET=1 it does nothing. With it (B7's admin project)
// it commits the deterministic data set to the database of DEV_DB_URL before any spec runs, after the production
// guard (invariant 4, ruling H35 (5)) and under the writer lock (G34). The set stays between runs; it is idempotent.
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { commitDataset, formatCounts } from "../fixtures/dataset";
import { holdDevLock } from "../fixtures/dev-lock";

export default async function globalSetup(): Promise<void> {
  if (process.env["E2E_DATASET"] !== "1") return;
  await assertNotProduction();
  const release = await holdDevLock();
  try {
    const counts = await commitDataset({ reset: false });
    process.stdout.write(`fixtures: ${formatCounts(counts)}\n`);
  } finally {
    await release();
  }
}
