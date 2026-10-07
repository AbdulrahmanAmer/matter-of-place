import { describe, expect, it } from "vitest";
import { approvalStillValid, mayApprove } from "../../../src/server/channels/approval.ts";

// Approval modes (B10 invariant 4, S23): `effectiveApprovalMode` decides each channel, and an agent needs `auto` on
// every enabled target channel.

const manual = { Feature: "manual", Reach: "manual", Campaign: "manual" } as const;
const featureAuto = { ...manual, Feature: "auto" } as const;
const autoRow = { enabled: true, approval_mode: featureAuto, auto_after: "2026-10-01" };
const manualRow = { enabled: true, approval_mode: manual, auto_after: "2026-10-01" };
const human = { kind: "human" } as const;
const agent = { kind: "agent" } as const;

describe("mayApprove", () => {
  it("lets a person approve whatever the mode", () => {
    expect(mayApprove(human, "Feature", [manualRow], "2026-10-07")).toBe(true);
  });

  it("refuses an agent in manual mode", () => {
    expect(mayApprove(agent, "Feature", [manualRow], "2026-10-07")).toBe(false);
  });

  it("allows an agent in auto mode from auto_after on, not the day before", () => {
    expect(mayApprove(agent, "Feature", [autoRow], "2026-10-01")).toBe(true);
    expect(mayApprove(agent, "Feature", [autoRow], "2026-09-30")).toBe(false);
    expect(mayApprove(agent, "Reach", [autoRow], "2026-10-07")).toBe(false);
  });

  it("reads a null auto_after with Feature auto as manual", () => {
    expect(mayApprove(agent, "Feature", [{ ...autoRow, auto_after: null }], "2026-10-07")).toBe(
      false,
    );
  });

  it("refuses an agent when one of two enabled target channels is still manual", () => {
    expect(mayApprove(agent, "Feature", [autoRow, manualRow], "2026-10-07")).toBe(false);
    expect(
      mayApprove(agent, "Feature", [autoRow, { ...manualRow, enabled: false }], "2026-10-07"),
    ).toBe(true);
  });

  it("refuses an agent when no target channel is enabled", () => {
    expect(mayApprove(agent, "Feature", [{ ...autoRow, enabled: false }], "2026-10-07")).toBe(
      false,
    );
  });
});

describe("approvalStillValid", () => {
  const asset = (approvedBy: string | null) => ({
    approved_by: approvedBy,
    tier: "Feature" as const,
  });

  it("keeps a person's approval in manual mode", () => {
    expect(approvalStillValid(asset("u1"), { actor_kind: "human" }, manualRow, "2026-10-07")).toBe(
      true,
    );
  });

  it("voids an agent's, the system's and a roleless approval while the channel is manual, keeps them in auto", () => {
    for (const [approvedBy, approver] of [
      ["u2", { actor_kind: "agent" }],
      [null, null],
      ["u3", null],
    ] as const) {
      expect(approvalStillValid(asset(approvedBy), approver, manualRow, "2026-10-07")).toBe(false);
      expect(approvalStillValid(asset(approvedBy), approver, autoRow, "2026-10-07")).toBe(true);
    }
  });
});
