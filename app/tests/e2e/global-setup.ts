// STUB(B4 step 8): the E2E_DATASET=1 branch holds the dev lock and loads the e2e data set before the admin project runs.
export default function globalSetup(): void {
  if (process.env["E2E_DATASET"] !== "1") return;
  throw new Error("E2E_DATASET=1 needs the data set of B4 step 8, which is not written yet");
}
