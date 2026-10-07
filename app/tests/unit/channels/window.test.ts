import { describe, expect, it } from "vitest";
import type { ChannelSettings } from "../../../src/domain/automation.ts";
import { nextWindowSlot, planRetry } from "../../../src/server/channels/window.ts";

// Posting windows (B10 invariants 3 and 3a). Every instant is UTC; the window is wall time in Los Angeles, which is
// UTC-7 in summer and UTC-8 in winter (2026: summer time from 8 March, winter time from 1 November).

const everyDay: ChannelSettings["posting_window"] = {
  days: [1, 2, 3, 4, 5, 6, 7],
  from: "09:00",
  to: "17:00",
  tz: "America/Los_Angeles",
  daily_cap: 2,
};
const tuesdays = { ...everyDay, days: [2] };
const at = (iso: string) => new Date(iso);

describe("nextWindowSlot", () => {
  it("answers now inside the window while the cap has room", () => {
    // Tuesday 6 October 2026, 10:00 PDT.
    expect(nextWindowSlot(at("2026-10-06T17:00:00Z"), everyDay, 1)).toEqual(
      at("2026-10-06T17:00:00Z"),
    );
  });

  it("waits for the window to open later the same day", () => {
    expect(nextWindowSlot(at("2026-10-06T14:00:00Z"), everyDay, 0)).toEqual(
      at("2026-10-06T16:00:00Z"),
    );
  });

  it("goes to the next day's opening once the daily cap is reached", () => {
    expect(nextWindowSlot(at("2026-10-06T17:00:00Z"), everyDay, 2)).toEqual(
      at("2026-10-07T16:00:00Z"),
    );
  });

  it("counts the local day, not the UTC day, in the Pacific evening", () => {
    // Tuesday 6 October 18:00 PDT is already Wednesday in UTC; cap spent, so Wednesday's opening.
    expect(nextWindowSlot(at("2026-10-07T01:00:00Z"), everyDay, 2)).toEqual(
      at("2026-10-07T16:00:00Z"),
    );
  });

  it("keeps 09:00 local across both daylight-saving changes", () => {
    // Saturday 7 March 18:00 PST; Sunday opens at 09:00 PDT.
    expect(nextWindowSlot(at("2026-03-08T02:00:00Z"), everyDay, 0)).toEqual(
      at("2026-03-08T16:00:00Z"),
    );
    // Saturday 31 October 18:00 PDT; Sunday opens at 09:00 PST.
    expect(nextWindowSlot(at("2026-11-01T01:00:00Z"), everyDay, 0)).toEqual(
      at("2026-11-01T17:00:00Z"),
    );
  });

  it("skips closed weekdays and reaches the same weekday a week on when today's cap is spent", () => {
    // Wednesday 7 October: the next Tuesday.
    expect(nextWindowSlot(at("2026-10-07T17:00:00Z"), tuesdays, 0)).toEqual(
      at("2026-10-13T16:00:00Z"),
    );
    // Tuesday 6 October inside the window, cap spent.
    expect(nextWindowSlot(at("2026-10-06T17:00:00Z"), tuesdays, 2)).toEqual(
      at("2026-10-13T16:00:00Z"),
    );
  });
});

describe("planRetry", () => {
  it("retries inside the window with 40 minutes left", () => {
    // 16:20 PDT, first attempt: the backoff is at most 36 seconds.
    expect(planRetry(at("2026-10-06T23:20:00Z"), everyDay, 0, 1, 12)).toEqual({
      at: at("2026-10-06T23:20:36Z"),
      moved: false,
    });
  });

  it("moves to the next slot with 1 minute left and a 2 minute backoff", () => {
    expect(planRetry(at("2026-10-06T23:59:00Z"), everyDay, 0, 3, 12)).toEqual({
      at: at("2026-10-07T16:00:00Z"),
      moved: true,
    });
  });

  it("moves to the next slot on the last attempt instead of failing", () => {
    expect(planRetry(at("2026-10-06T17:00:00Z"), everyDay, 0, 12, 12)).toEqual({
      at: at("2026-10-07T16:00:00Z"),
      moved: true,
    });
  });

  it("moves to the next day when the daily cap has no room", () => {
    expect(planRetry(at("2026-10-06T17:00:00Z"), everyDay, 2, 1, 12)).toEqual({
      at: at("2026-10-07T16:00:00Z"),
      moved: true,
    });
  });
});
