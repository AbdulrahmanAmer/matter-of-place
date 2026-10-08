import { describe, expect, it } from "vitest";
import { assertQuota } from "../../../src/server/newsletter/quota";
import { emailWorld, NOW, PRODUCTION_SHARE } from "../../fixtures/email-send";

// B11 invariant 5 (P-009, INT-03): a broadcast is bulk mail, so it is held to `bulk_cap` (50 in production), never to
// `daily_cap` (75), and to `monthly_cap` (2,600) for the month. `email_sent_today()` and `email_sent_month()` are B5's
// counts, which already hold the broadcasts sent before.

const check = (recipients: number, sentToday = 0, sentMonth = 0) =>
  assertQuota(emailWorld({ share: PRODUCTION_SHARE, sentToday, sentMonth }).db, recipients, NOW);

describe("assertQuota", () => {
  it("refuses 51 recipients as exceeds_plan: no day of the free plan can send them", async () => {
    expect(await check(51)).toMatchObject({ status: "exceeds_plan", recipients: 51, bulkCap: 50 });
  });

  it("holds 30 recipients with 25 sent today to tomorrow: 55 is over bulk_cap though under daily_cap", async () => {
    expect(await check(30, 25)).toEqual({
      status: "retry_tomorrow",
      at: new Date("2026-10-06T00:01:00.000Z"),
      recipients: 30,
      sentToday: 25,
      sentMonth: 0,
      bulkCap: 50,
      monthlyCap: 2600,
    });
  });

  it("lets 20 recipients with 25 sent today go", async () => {
    expect(await check(20, 25)).toMatchObject({ status: "ok", sentToday: 25 });
  });

  it("refuses at monthly_cap 2,600 until the 1st of next month, and lets a send that reaches it exactly go", async () => {
    expect(await check(20, 0, 2590)).toMatchObject({
      status: "retry_next_month",
      at: new Date("2026-11-01T00:01:00.000Z"),
    });
    expect(await check(20, 0, 2580)).toMatchObject({ status: "ok" });
  });

  it("refuses to guess without settings.email", async () => {
    const { db } = emailWorld({ share: {} });
    await expect(assertQuota(db, 1, NOW)).rejects.toThrow("email_settings_missing");
  });
});
