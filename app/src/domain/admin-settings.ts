import { z } from "zod";
import { dailyLimitsSchema } from "./admin-team.ts";
import { invoiceSettingsSchema } from "./payments.ts";
import { siteSettingsSchema } from "./settings.ts";

// Screen 24 (B7 step 15). The API JSON is the stored value of each `settings` key under its own snake_case name
// (G-004). `site` is B16's schema and `invoice` B6's; the three keys below them are written by `put_setting`.

/** `PUT /api/admin/settings/invoice`: B6's schema as it stands, so the screen and `settings_put_invoice` agree. */
export const invoicePutInput = invoiceSettingsSchema;

/** `PUT /api/admin/settings/coming-soon`: the whole site shows the coming-soon page while this is true. */
export const comingSoonPutInput = z.object({ coming_soon_global: z.boolean() }).strict();

/** `settings.notifications`: who hears admin alerts, before the public contact address and `ADMIN_NOTIFY_EMAIL`. */
export const notificationsPutInput = z
  .object({
    recipients: z
      .array(z.string().trim().toLowerCase().email().max(254))
      .max(20)
      .refine((list) => new Set(list).size === list.length, { message: "List each address once." }),
  })
  .strict();

export type NotificationsInput = z.infer<typeof notificationsPutInput>;

/** `GET /api/admin/settings`: the five keys of screen 24 and what still stands between the site and launch. */
export const settingsAnswerSchema = z.object({
  site: siteSettingsSchema,
  /** Null until B6's invoice settings have been saved once, or when the stored value no longer parses. */
  invoice: invoiceSettingsSchema.nullable(),
  coming_soon_global: z.boolean(),
  notifications: notificationsPutInput,
  /** Null when the seeded row is missing or unreadable; screen 23 edits it. */
  agent_daily_limits: dailyLimitsSchema.nullable(),
  /** Dotted names of the settings still unset (B16's identity fields, then B6's invoice fields), each once. */
  readiness: z.array(z.string()),
});

export type SettingsAnswer = z.infer<typeof settingsAnswerSchema>;
