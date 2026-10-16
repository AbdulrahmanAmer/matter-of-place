import { z } from "zod";

// Settings, Service usage (W7 item 7): the lines of `vendor_usage`, read only. `used` and `measured_at` are null for a
// line the laptop has not measured yet; `percent` is null without a limit or a measurement and may pass 100.

/** The lines in the order the section shows them: the three the weekly audit measures, egress, then the Claude week. */
export const usageLineKeys = [
  "workers_requests_day",
  "storage_egress",
  "sentry_errors",
  "actions_minutes",
  "claude_week",
] as const;

const usageLineSchema = z.object({
  line: z.enum(usageLineKeys),
  used: z.number().nullable(),
  limit: z.number().nullable(),
  percent: z.number().nullable(),
  note: z.string().nullable(),
  measured_at: z.string().nullable(),
});

export type UsageLine = z.infer<typeof usageLineSchema>;

/** `GET /api/admin/settings/usage`. */
export const usageAnswerSchema = z.object({ lines: z.array(usageLineSchema) });

export type UsageAnswer = z.infer<typeof usageAnswerSchema>;
