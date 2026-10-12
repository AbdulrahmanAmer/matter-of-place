import { describe, expect, it } from "vitest";
import { forwardPollInterval } from "../../src/admin/inquiries/inquiries-queries";

// Gap audit item 15: the inquiry drawer polls the forward job every two seconds, and stops once the job has finished
// or once its read keeps failing after react-query's retries.
describe("forwardPollInterval", () => {
  it("polls while the job runs, and stops when it has finished or the read failed", () => {
    expect([
      forwardPollInterval({ status: "success", data: { status: "running" } }),
      forwardPollInterval({ status: "pending" }),
      forwardPollInterval({ status: "success", data: { status: "done" } }),
      forwardPollInterval({ status: "error" }),
    ]).toEqual([2000, 2000, false, false]);
  });
});
