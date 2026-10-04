import { describe, expect, it } from "vitest";
import {
  approvalModeLabels,
  approvalModes,
  declineReasonSchema,
  scheduleSettingsSchema,
  channelLabels,
  channels,
  channelSettingsSchema,
  effectiveApprovalMode,
  scheduleSettingsPutSchema,
  skipReasonLabels,
  skipReasons,
} from "../../../src/domain/automation";

const postingWindow = {
  days: [1, 2, 3, 4, 5],
  from: "09:00",
  to: "18:00",
  tz: "America/New_York",
  daily_cap: 2,
};

const settings = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  posting_window: postingWindow,
  approval_mode: { Feature: "auto", Reach: "manual", Campaign: "manual" },
  auto_after: "2026-12-03",
  credentials_ref: "meta",
  ...overrides,
});

function issuePaths(input: unknown): string[] {
  const result = channelSettingsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("effective approval mode", () => {
  const auto = {
    approval_mode: { Feature: "auto", Reach: "manual", Campaign: "auto" },
    auto_after: "2026-12-03",
  } as const;

  it("is manual when auto_after is null", () => {
    expect(effectiveApprovalMode({ ...auto, auto_after: null }, "Feature", "2027-01-01")).toBe(
      "manual",
    );
  });

  it("is manual before auto_after and auto on and after it", () => {
    expect(effectiveApprovalMode(auto, "Feature", "2026-12-02")).toBe("manual");
    expect(effectiveApprovalMode(auto, "Feature", "2026-12-03")).toBe("auto");
    expect(effectiveApprovalMode(auto, "Feature", "2027-02-01")).toBe("auto");
  });

  it("is always manual for a tier set to manual", () => {
    expect(effectiveApprovalMode(auto, "Reach", "2027-02-01")).toBe("manual");
  });
});

describe("channel settings", () => {
  it("accepts a window with a zone and fills a daily cap of 2", () => {
    const { daily_cap: _cap, ...withoutCap } = postingWindow;
    const parsed = channelSettingsSchema.parse(settings({ posting_window: withoutCap }));
    expect(parsed.posting_window.daily_cap).toBe(2);
  });

  it("refuses a window without tz", () => {
    const { tz: _tz, ...withoutTz } = postingWindow;
    expect(issuePaths(settings({ posting_window: withoutTz }))).toEqual(["posting_window.tz"]);
  });

  it("refuses an unknown zone", () => {
    expect(
      issuePaths(settings({ posting_window: { ...postingWindow, tz: "Mars/Olympus" } })),
    ).toEqual(["posting_window.tz"]);
    expect(
      channelSettingsSchema.safeParse(settings({ posting_window: { ...postingWindow, tz: "UTC" } }))
        .success,
    ).toBe(true);
  });

  it("refuses a window that does not start before it ends", () => {
    expect(
      issuePaths(settings({ posting_window: { ...postingWindow, from: "18:00", to: "09:00" } })),
    ).toEqual(["posting_window.from"]);
    expect(
      issuePaths(settings({ posting_window: { ...postingWindow, from: "09:00", to: "09:00" } })),
    ).toEqual(["posting_window.from"]);
  });

  it("refuses a daily_cap of 0 or 26 with its path", () => {
    expect(issuePaths(settings({ posting_window: { ...postingWindow, daily_cap: 0 } }))).toEqual([
      "posting_window.daily_cap",
    ]);
    expect(issuePaths(settings({ posting_window: { ...postingWindow, daily_cap: 26 } }))).toEqual([
      "posting_window.daily_cap",
    ]);
  });
});

describe("schedule put", () => {
  it("accepts the four keys a person may change", () => {
    const parsed = scheduleSettingsPutSchema.safeParse({
      cron: "0 14 * * 2",
      interval_days: 14,
      enabled: true,
      last_run_at: "2026-10-07T14:00:00Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses next_run_at and any other key", () => {
    expect(
      scheduleSettingsPutSchema.safeParse({ next_run_at: "2026-10-07T14:00:00Z" }).success,
    ).toBe(false);
    expect(scheduleSettingsPutSchema.safeParse({ key: "digest" }).success).toBe(false);
  });
});

describe("schedule and decline rows", () => {
  it("parses a seeded schedule row and refuses a cron of three fields", () => {
    const digest = {
      cron: "0 14 * * 2",
      interval_days: 14,
      enabled: false,
      last_run_at: null,
      next_run_at: null,
    };
    expect(scheduleSettingsSchema.safeParse(digest).success).toBe(true);
    expect(scheduleSettingsSchema.safeParse({ ...digest, cron: "0 14 *" }).success).toBe(false);
    expect(scheduleSettingsSchema.safeParse({ ...digest, interval_days: 0 }).success).toBe(false);
  });

  it("accepts a decline reason with no paragraph and refuses a bad code", () => {
    const other = { code: "other", label: "Other, see note", email_paragraph: "" };
    expect(declineReasonSchema.parse(other)).toEqual({ ...other, enabled: true });
    expect(declineReasonSchema.safeParse({ ...other, code: "Not A Slug" }).success).toBe(false);
    expect(declineReasonSchema.safeParse({ ...other, label: "" }).success).toBe(false);
  });
});

describe("screen labels", () => {
  it("has a label with no em dash for every channel and skip reason", () => {
    const labels = [
      ...channels.map((channel) => channelLabels[channel]),
      ...skipReasons.map((reason) => skipReasonLabels[reason]),
      ...approvalModes.map((mode) => approvalModeLabels[mode]),
    ];
    expect(labels.every((label) => label.length > 0 && !label.includes("—"))).toBe(true);
  });
});
