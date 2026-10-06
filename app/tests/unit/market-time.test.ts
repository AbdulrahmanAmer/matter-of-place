import { describe, expect, it } from "vitest";
import { formatInZone, marketTimezone, toUtc } from "../../src/domain/market-time";

// GD-06: the database stores UTC; a screen shows the market's wall time with its zone named, across both
// daylight-saving changes (2026: 8 March and 1 November).

const plain = (text: string) => text.replace(/\s/g, " ");

describe("market time", () => {
  it("maps california to Pacific and the other markets and no market to Eastern", () => {
    expect(["california", "new-york", "florida", null].map(marketTimezone)).toEqual([
      "America/Los_Angeles",
      "America/New_York",
      "America/New_York",
      "America/New_York",
    ]);
  });

  it("renders the right Pacific and Eastern wall time on the day daylight saving starts", () => {
    const pacific = marketTimezone("california");
    const eastern = marketTimezone("florida");
    expect(
      [
        formatInZone("2026-03-08T09:30:00Z", pacific, "datetime"),
        formatInZone("2026-03-08T10:30:00Z", pacific, "datetime"),
        formatInZone("2026-03-08T06:30:00Z", eastern, "datetime"),
        formatInZone("2026-03-08T07:30:00Z", eastern, "time"),
        formatInZone("2026-03-08T04:30:00Z", eastern, "date"),
      ].map(plain),
    ).toEqual([
      "Mar 8, 2026, 1:30 AM PT",
      "Mar 8, 2026, 3:30 AM PT",
      "Mar 8, 2026, 1:30 AM ET",
      "3:30 AM ET",
      "Mar 7, 2026 ET",
    ]);
  });

  it("renders the right wall time on the day daylight saving ends", () => {
    const eastern = marketTimezone("new-york");
    expect(
      [
        formatInZone("2026-11-01T05:30:00Z", eastern, "time"),
        formatInZone("2026-11-01T06:30:00Z", eastern, "time"),
      ].map(plain),
    ).toEqual(["1:30 AM ET", "1:30 AM ET"]);
  });

  it("converts a typed wall time to UTC, moving a skipped time forward and taking the first of a repeated one", () => {
    expect([
      toUtc("2026-03-08T01:30", "America/Los_Angeles"),
      toUtc("2026-03-08T03:30", "America/Los_Angeles"),
      toUtc("2026-03-08T02:30", "America/New_York"),
      toUtc("2026-11-01T01:30", "America/New_York"),
      toUtc("2026-07-01T12:00", "America/New_York"),
    ]).toEqual([
      "2026-03-08T09:30:00.000Z",
      "2026-03-08T10:30:00.000Z",
      "2026-03-08T07:30:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-07-01T16:00:00.000Z",
    ]);
    expect(() => toUtc("2026-07-01", "America/New_York")).toThrow(RangeError);
  });
});
