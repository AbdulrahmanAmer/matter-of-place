import { describe, expect, it } from "vitest";
import { waitingByScreen } from "../../src/admin/ui/waiting-counts";

// W3 stage 5: the count on each tab is what waits for a person there.
const dashboard = {
  counts: { Submitted: 2, "Under Review": 1, Published: 7 },
  jobs: { failed_24h: 1, dead: 2 },
  assets_pending: 4,
};

describe("waiting counts", () => {
  it("counts requests to decide, visuals to approve, jobs that failed and proposals pending", () => {
    expect(
      waitingByScreen(dashboard, [
        { state: "pending" },
        { state: "approved" },
        { state: "pending" },
      ]),
    ).toEqual({ 3: 3, 10: 4, 16: 3, 29: 2 });
  });

  it("counts nothing it has not read", () => {
    expect(waitingByScreen(undefined, undefined)).toEqual({});
  });
});
