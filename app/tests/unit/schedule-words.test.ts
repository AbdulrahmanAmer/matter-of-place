import { describe, expect, it } from "vitest";
import {
  cadenceOf,
  cronOf,
  officeOffset,
  sayCadence,
  scheduleName,
  toOffice,
} from "../../src/admin/automation/schedule-words";

// W3 stage 3: a clock is read and set in words and Cairo time; the database keeps UTC cron.
const summer = new Date("2026-10-12T09:00:00Z");
const winter = new Date("2026-12-12T09:00:00Z");

describe("schedule words", () => {
  it("knows Cairo is three hours ahead in October and two in December", () => {
    expect([officeOffset(summer), officeOffset(winter)]).toEqual([180, 120]);
  });

  it("reads the shapes the clocks use and leaves any other cron as custom", () => {
    expect([
      cadenceOf("*/10 * * * *"),
      cadenceOf("17 3 * * *"),
      cadenceOf("0 12 * * 6"),
      cadenceOf("0 0 1 * *"),
    ]).toEqual([
      { kind: "minutes", every: 10 },
      { kind: "daily", hour: 3, minute: 17 },
      { kind: "weekly", day: 6, hour: 12, minute: 0 },
      { kind: "other" },
    ]);
  });

  it("says each clock in words and Cairo time", () => {
    expect([
      sayCadence("*/10 * * * *", null, summer),
      sayCadence("17 3 * * *", null, summer),
      sayCadence("0 12 * * 6", null, summer),
      sayCadence("0 22 * * 6", null, summer),
      sayCadence("0 14 * * 2", 14, summer),
      sayCadence("0 0 1 * *", null, summer),
    ]).toEqual([
      "Every 10 minutes",
      "Every day at 06:17, Cairo time",
      "Every Saturday at 15:00, Cairo time",
      "Every Sunday at 01:00, Cairo time",
      "Every 14 days, on a Tuesday at 17:00, Cairo time",
      "On a custom timetable (0 0 1 * *, UTC)",
    ]);
  });

  it("writes a Cairo time back as the UTC cron, across midnight, and round-trips", () => {
    expect([
      cronOf({ kind: "daily", hour: 9, minute: 0 }, summer),
      cronOf({ kind: "weekly", day: 6, hour: 1, minute: 30 }, summer),
      cronOf({ kind: "daily", hour: 9, minute: 0 }, winter),
      cronOf({ kind: "minutes", every: 15 }, summer),
    ]).toEqual(["0 6 * * *", "30 22 * * 5", "0 7 * * *", "*/15 * * * *"]);
    const local = toOffice(cadenceOf("45 23 * * 3"), summer);
    expect(cronOf(local, summer)).toBe("45 23 * * 3");
  });

  it("names each clock for what it does", () => {
    expect([scheduleName("kpi_weekly"), scheduleName("prune"), scheduleName("new_clock")]).toEqual([
      "Weekly numbers",
      "Nightly clean-up",
      "new clock",
    ]);
  });
});
