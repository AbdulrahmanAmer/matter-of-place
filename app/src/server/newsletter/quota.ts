import { emailSettingsSchema } from "../../domain/email.ts";
import { readSettings } from "../email/context.ts";
import { nextUtcMidnight, nextUtcMonth } from "../email/resend-errors.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";

// The free-tier gate of a broadcast (B11 invariant 5, P-009). A broadcast is bulk mail, so today's total is held to
// `settings.email.bulk_cap`, never `daily_cap`: the rest of the day stays free for invoices, confirmations and alerts.
// `email_sent_today()` and `email_sent_month()` already count the broadcasts sent before this one.

interface QuotaNumbers {
  recipients: number;
  sentToday: number;
  sentMonth: number;
  bulkCap: number;
  monthlyCap: number;
}

export type QuotaCheck = QuotaNumbers &
  (
    | { status: "ok" }
    | { status: "exceeds_plan" }
    | { status: "retry_tomorrow"; at: Date }
    | { status: "retry_next_month"; at: Date }
  );

async function count(db: Db, fn: "email_sent_today" | "email_sent_month"): Promise<number> {
  const { data, error } = await db.rpc(fn);
  if (error !== null) throw new Error(`email_read_failed:${fn}`);
  return data;
}

/**
 * Whether `recipients` more bulk messages fit: `exceeds_plan` when the audience alone is over `bulk_cap` (no day ever
 * fits it, a paid plan is a decision, G-011), `retry_next_month` when the month's total would pass `monthly_cap`,
 * `retry_tomorrow` when only today's total would pass `bulk_cap`.
 */
export async function assertQuota(db: Db, recipients: number, now: Date): Promise<QuotaCheck> {
  const share = emailSettingsSchema.safeParse((await readSettings(db, ["email"])).get("email"));
  if (!share.success) throw new NonRetryableError("email_settings_missing");
  const numbers: QuotaNumbers = {
    recipients,
    sentToday: await count(db, "email_sent_today"),
    sentMonth: await count(db, "email_sent_month"),
    bulkCap: share.data.bulk_cap,
    monthlyCap: share.data.monthly_cap,
  };
  if (recipients > numbers.bulkCap) return { ...numbers, status: "exceeds_plan" };
  if (numbers.sentMonth + recipients > numbers.monthlyCap) {
    return { ...numbers, status: "retry_next_month", at: nextUtcMonth(now) };
  }
  if (numbers.sentToday + recipients > numbers.bulkCap) {
    return { ...numbers, status: "retry_tomorrow", at: nextUtcMidnight(now) };
  }
  return { ...numbers, status: "ok" };
}
