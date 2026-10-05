import { z } from "zod";
import { assetKinds, marketSlugs, type Tier, tiers } from "./events.ts";

// The shapes of the automation console (screens 17 to 21). Field names equal the API JSON and the columns of
// `automation_recipes`, `channel_settings`, `schedule_settings` and `decline_reasons` (G-004).

const idSlug = z
  .string()
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, digits, hyphens and underscores");

export const conditionsSchema = z
  .object({
    tiers: z.array(z.enum(tiers)).min(1).optional(),
    markets: z.array(z.enum(marketSlugs)).min(1).optional(),
    kinds: z.array(z.enum(assetKinds)).min(1).optional(),
  })
  .strict();

export type Conditions = z.infer<typeof conditionsSchema>;

export const stepSchema = z.object({
  id: idSlug,
  step_type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  requires_approval: z.boolean().default(false),
  conditions: conditionsSchema.default({}),
});

export type Step = z.infer<typeof stepSchema>;

const maxSteps = 20;

export const recipeSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  steps: z
    .array(stepSchema)
    .max(maxSteps)
    .superRefine((steps, context) => {
      const seen = new Set<string>();
      steps.forEach((step, index) => {
        if (seen.has(step.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Step ids must be unique in a recipe",
            path: [index, "id"],
          });
        }
        seen.add(step.id);
      });
    }),
});

export type Recipe = z.infer<typeof recipeSchema>;

export const declineReasonSchema = z.object({
  code: idSlug,
  label: z.string().min(1).max(120),
  // `other` carries no paragraph: the admin's note is the message.
  email_paragraph: z.string().max(1000),
  sort: z.number().int().min(0).optional(),
  enabled: z.boolean().default(true),
});

export const channels = [
  "instagram",
  "x",
  "linkedin",
  "facebook",
  "youtube",
  "newsletter",
] as const;
export type Channel = (typeof channels)[number];

const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24 hour time, HH:MM");

function isTimeZone(value: string): boolean {
  try {
    // eslint-disable-next-line no-restricted-syntax -- checks that a zone name exists, formats nothing (invariant 13)
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// `days` are ISO weekdays (1 Monday to 7 Sunday); `from` and `to` are wall time in `tz`, so a window keeps its local
// hours across daylight saving (invariant 13).
const postingWindowSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1),
    from: wallTime,
    to: wallTime,
    tz: z.string().refine(isTimeZone, "Use an IANA time zone, such as America/New_York"),
    daily_cap: z.number().int().min(1).max(25).default(2),
  })
  .refine((window) => window.from < window.to, {
    message: "The window must start before it ends",
    path: ["from"],
  });

export const approvalModes = ["manual", "auto"] as const;
export type ApprovalMode = (typeof approvalModes)[number];

export const channelSettingsSchema = z.object({
  enabled: z.boolean(),
  posting_window: postingWindowSchema,
  approval_mode: z.object({
    Feature: z.enum(approvalModes),
    Reach: z.enum(approvalModes),
    Campaign: z.enum(approvalModes),
  }),
  auto_after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  // The NAME of a secret, never a value (G-006).
  credentials_ref: z.string().min(1).nullable(),
});

export type ChannelSettings = z.infer<typeof channelSettingsSchema>;

// Cron and `next_run_at` are UTC (invariant 13).
const cron = z.string().regex(/^\S+(\s+\S+){4}$/, "Use five cron fields");
const intervalDays = z.number().int().min(1).max(90);

export const scheduleSettingsSchema = z.object({
  cron,
  interval_days: intervalDays.nullable(),
  enabled: z.boolean(),
  last_run_at: z.string().datetime({ offset: true }).nullable(),
  next_run_at: z.string().datetime({ offset: true }).nullable(),
});

/** The four keys a person may change; `next_run_at` belongs to the scheduler (invariant 11). */
export const scheduleSettingsPutSchema = z
  .object({
    cron: cron.optional(),
    interval_days: intervalDays.nullable().optional(),
    enabled: z.boolean().optional(),
    last_run_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

/**
 * S23: a channel posts without a person only for a tier set to `auto`, and only from `auto_after` on. `today` is a
 * `YYYY-MM-DD` date; a null `auto_after` means never automatic.
 */
export function effectiveApprovalMode(
  settings: Pick<ChannelSettings, "approval_mode" | "auto_after">,
  tier: Tier,
  today: string,
): ApprovalMode {
  if (settings.approval_mode[tier] !== "auto") return "manual";
  if (settings.auto_after === null || today < settings.auto_after) return "manual";
  return "auto";
}

export const skipReasons = [
  "recipe_disabled",
  "step_disabled",
  "condition",
  "not_implemented",
  "invalid_params",
] as const;
export type SkipReason = (typeof skipReasons)[number];

export const skipReasonLabels: Record<SkipReason, string> = {
  recipe_disabled: "The recipe is off",
  step_disabled: "The step is off",
  condition: "The event does not match the step's conditions",
  not_implemented: "The step is not built yet",
  invalid_params: "The step's settings are not valid",
};

export const channelLabels: Record<Channel, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube",
  newsletter: "Place Notes",
};

export const approvalModeLabels: Record<ApprovalMode, string> = {
  manual: "A person approves each post",
  auto: "Posts without approval",
};
