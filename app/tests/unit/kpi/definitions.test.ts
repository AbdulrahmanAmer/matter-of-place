import { describe, expect, it } from "vitest";
import { collectWeeklyKpis } from "../../../src/server/kpi/collect";
import {
  kpiDefinitions,
  kpiLines,
  lastFullWeekStart,
  NO_PUBLISHED_PROPERTIES,
  type KpiWeek,
} from "../../../src/server/kpi/definitions";
import { fakeDb } from "../../fixtures/fake-db";

// B11 invariant 12: the eight weekly numbers, their words and how each reads against the week before.

function week(overrides: Partial<KpiWeek> = {}): KpiWeek {
  return {
    week_start: "2026-09-21",
    week_end: "2026-09-27",
    submissions_received: 4,
    decisions: { accepted: 2, declined: 1 },
    time_to_decision_hours: 30.5,
    invoices: { issued: 2, issued_amount: 5000, paid: 1, paid_amount: 2500 },
    properties_published: 1,
    posts_by_channel: { x: 2, instagram: 3 },
    newsletter: { confirmed: 5, unsubscribed: 1, net: 4, total_confirmed: 120 },
    inquiries: { received: 6, published_properties: 4, top: [] },
    ...overrides,
  };
}

const lineOf = (current: KpiWeek, previous: KpiWeek, key: string) =>
  kpiLines(current, previous).find((line) => line.key === key);

describe("kpi definitions", () => {
  it("lists the eight KPIs, each with a label, a definition and a unit", () => {
    expect(kpiDefinitions.map(({ key }) => key)).toEqual([
      "submissions_received",
      "acceptance_rate",
      "time_to_decision",
      "invoices",
      "properties_published",
      "posts_by_channel",
      "newsletter_growth",
      "inquiries_per_property",
    ]);
    for (const { label, definition, unit } of kpiDefinitions) {
      expect([label, definition, unit].every((text) => text.trim() !== "")).toBe(true);
    }
  });

  it("reads an acceptance rate of no decisions as 0 of 0", () => {
    const none = week({ decisions: { accepted: 0, declined: 0 } });
    expect(lineOf(none, none, "acceptance_rate")).toMatchObject({
      value: "0 of 0",
      change: "prior week 0 of 0",
    });
    expect(lineOf(week(), none, "acceptance_rate")?.value).toBe("2 of 3");
  });

  it("reads inquiries per property as the sentence when nothing is published", () => {
    const empty = week({ inquiries: { received: 3, published_properties: 0, top: [] } });
    expect(lineOf(empty, empty, "inquiries_per_property")).toMatchObject({
      value: NO_PUBLISHED_PROPERTIES,
      change: "prior week none",
    });
    expect(lineOf(week(), empty, "inquiries_per_property")?.value).toBe(
      "1.5 (6 inquiries, 4 properties)",
    );
    expect(lineOf(week(), week(), "inquiries_per_property")?.change).toBe("no change");
  });

  it("shows a count's change against the prior week as +n, -n or no change", () => {
    const before = week();
    const changes = (current: KpiWeek) =>
      kpiLines(current, before).map(({ key, change }) => [key, change]);
    expect(
      changes(
        week({
          submissions_received: 7,
          time_to_decision_hours: 28,
          invoices: { issued: 1, issued_amount: 2500, paid: 1, paid_amount: 2500 },
          properties_published: 0,
          posts_by_channel: { instagram: 1 },
          newsletter: { confirmed: 2, unsubscribed: 0, net: 2, total_confirmed: 122 },
          inquiries: { received: 9, published_properties: 4, top: [] },
        }),
      ),
    ).toEqual([
      ["submissions_received", "+3"],
      ["acceptance_rate", "prior week 2 of 3"],
      ["time_to_decision", "-2.5 hours"],
      ["invoices", "issued -1, paid no change"],
      ["properties_published", "-1"],
      ["posts_by_channel", "-4 posts"],
      ["newsletter_growth", "+2 in total"],
      ["inquiries_per_property", "+0.75"],
    ]);
  });

  it("reads each value in words with its unit", () => {
    expect(kpiLines(week(), week()).map(({ value }) => value)).toEqual([
      "4",
      "2 of 3",
      "30.5 hours",
      "2 issued ($5,000.00), 1 paid ($2,500.00)",
      "1",
      "instagram 3, x 2",
      "5 confirmed, 1 unsubscribed, net +4, 120 in total",
      "1.5 (6 inquiries, 4 properties)",
    ]);
    const quiet = week({ time_to_decision_hours: null, posts_by_channel: {} });
    expect(kpiLines(quiet, week()).map(({ value }) => value)).toContain("none");
    expect(lineOf(quiet, week(), "time_to_decision")?.change).toBe("prior week 30.5 hours");
  });

  it("starts the last full week on the Monday before the last Sunday, on New York's calendar", () => {
    expect(lastFullWeekStart(new Date("2026-10-10T15:00:00Z"))).toBe("2026-09-28");
    // Monday 03:00 UTC is still Sunday evening in New York, so the week that just ended is not full yet.
    expect(lastFullWeekStart(new Date("2026-10-05T03:00:00Z"))).toBe("2026-09-21");
    expect(lastFullWeekStart(new Date("2026-10-05T05:00:00Z"))).toBe("2026-09-28");
  });

  it("reads the week and the week before from kpi_weekly", async () => {
    const asked: unknown[] = [];
    const db = fakeDb({
      rpc: {
        kpi_weekly: (args) => {
          asked.push(args.p_week_start);
          return week({ week_start: args.p_week_start });
        },
      },
    });
    const kpis = await collectWeeklyKpis(db, "2026-09-21");
    expect([...asked].sort()).toEqual(["2026-09-14", "2026-09-21"]);
    expect([kpis.current.week_start, kpis.previous.week_start]).toEqual([
      "2026-09-21",
      "2026-09-14",
    ]);
  });

  it("fails the read when kpi_weekly answers an error", async () => {
    const refused = Object.assign(new Error("validation"), { code: "22023" });
    const db = fakeDb({ rpc: { kpi_weekly: () => refused } });
    await expect(collectWeeklyKpis(db, "2026-09-22")).rejects.toThrow("kpi_weekly_failed:22023");
  });
});
