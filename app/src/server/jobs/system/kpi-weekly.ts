import { z } from "zod";
import { renderCeoWeekly } from "../../../templates/email/ceo-weekly.tsx";
import { loadSiteContext, resolveAdminRecipients } from "../../email/context.ts";
import { collectWeeklyKpis } from "../../kpi/collect.ts";
import { lastFullWeekStart } from "../../kpi/definitions.ts";
import { sendEach } from "../steps/send-email.ts";
import type { StepContext, StepResult, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// System job `kpi_weekly` (B11 invariant 12, GG-03): `runDueSchedules` enqueues it every Saturday from the
// `schedule_settings` row of the same name, so screen 20 can pause it. It counts the last full week and mails it to
// every admin recipient through B5's `sendOne`, one `alert` message row per address. `scripts/kpi-send.ts` sets
// `data.week_start` and `data.to` to send one chosen week to one address.

const isMonday = (date: string): boolean => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

const input = z.object({
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isMonday)
    .optional(),
  to: z.string().email().optional(),
});

async function run(ctx: StepContext, data: Record<string, unknown>): Promise<StepResult> {
  const parsed = input.safeParse(data);
  if (!parsed.success) throw new NonRetryableError("kpi_input_invalid");
  const { week_start: weekStart = lastFullWeekStart(ctx.now), to } = parsed.data;
  const kpis = await collectWeeklyKpis(ctx.db, weekStart);
  const recipients = to === undefined ? await resolveAdminRecipients(ctx.db) : [to];
  const email = await renderCeoWeekly(kpis, await loadSiteContext(ctx.db));
  return sendEach(ctx, recipients, { templateKey: "kpi_weekly", kind: "alert", rendered: email });
}

export const kpiWeekly: SystemJobDefinition = {
  type: "kpi_weekly",
  sideEffect: "idempotency_key",
  maxAttempts: 12,
  run: (ctx, _params, data) => run(ctx, data),
};
