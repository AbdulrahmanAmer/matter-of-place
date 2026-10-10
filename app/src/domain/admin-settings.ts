import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { dailyLimitsSchema } from "./admin-team.ts";
import type { redirectStatuses } from "./contracts.ts";
import { invoiceSettingsSchema } from "./payments.ts";
import { siteSettingsSchema } from "./settings.ts";

// Screen 24 (B7 step 15). The API JSON is the stored value of each `settings` key under its own snake_case name
// (G-004). `site` is B16's schema and `invoice` B6's; the three keys below them are written by `put_setting`.

/** `PUT /api/admin/settings/invoice`: B6's schema as it stands, so the screen and `settings_put_invoice` agree. */
export const invoicePutInput = invoiceSettingsSchema;

export type InvoiceSettings = z.output<typeof invoicePutInput>;

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

// Redirects (B7 step 15a, invariant 16, GG-01). Screen 24 is the one editor of `redirects`; `put_redirect` mirrors
// every rule of `redirectSchema` in SQL, so a row refused by either answers 422 `invalid_redirect`.

/** The statuses screen 24 offers: B2's `redirectStatuses` narrowed to the permanent and the temporary move. */
export const redirectStatusChoices = [
  301, 302,
] as const satisfies readonly (typeof redirectStatuses)[number][];

/** One active redirect as listed; `from_path` is unique among active rows. */
export const redirectRowSchema = z.object({
  id: z.string().uuid(),
  from_path: z.string(),
  to_path: z.string(),
  status: z.number().int(),
});

export type RedirectRow = z.infer<typeof redirectRowSchema>;

/** `GET settings/redirects`: active rows in `from_path` order, the cursor the last `from_path` of the page before. */
export const redirectListInput = adminPageSchema;

export const redirectPageSchema = adminPageAnswer(redirectRowSchema);

/** `PUT settings/redirects` as sent. Loose on purpose: the rules are `redirectSchema`'s, answered `invalid_redirect`. */
export const redirectPutInput = z
  .object({
    /** Absent for a new row; the id of an active row to change it. */
    id: z.string().uuid().optional(),
    from_path: z.string().trim().max(200),
    to_path: z.string().trim().max(200),
    status: z.number().int(),
  })
  .strict();

export type RedirectPutInput = z.infer<typeof redirectPutInput>;

/** `DELETE settings/redirects`: the row to archive (GD-04). */
export const redirectArchiveInput = z.object({ id: z.string().uuid() }).strict();

export const redirectArchivedSchema = redirectRowSchema.extend({ archived_at: z.string() });

export type RedirectArchived = z.infer<typeof redirectArchivedSchema>;

const sitePath = (path: string) => path.startsWith("/") && !path.startsWith("//");

/** True when following `to_path` through the other active rows comes back to `from_path`. */
function closesLoop(row: RedirectPutInput, active: readonly RedirectRow[]): boolean {
  const next = new Map(
    active.filter((other) => other.id !== row.id).map((other) => [other.from_path, other.to_path]),
  );
  const seen = new Set<string>();
  for (let path: string | undefined = row.to_path; path !== undefined; path = next.get(path)) {
    if (path === row.from_path) return true;
    if (seen.has(path)) return false;
    seen.add(path);
  }
  return false;
}

/**
 * A redirect row checked against the other active rows (invariant 16): a public path with no query string as the
 * source, unique among active rows; a path on this site as the target; 301 or 302; and no loop.
 */
export function redirectSchema(active: readonly RedirectRow[]) {
  return redirectPutInput.superRefine((row, ctx) => {
    const refuse = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    const from = row.from_path;
    if (!sitePath(from)) refuse("The old address must be a path on this site.");
    else if (from.startsWith("/admin") || from === "/api" || from.startsWith("/api/")) {
      refuse("Admin and API addresses cannot be redirected.");
    } else if (from.includes("?")) refuse("The old address cannot carry a query string.");
    else if (!sitePath(row.to_path)) refuse("The new address must be a path on this site.");
    else if (row.to_path === from) refuse("A redirect cannot point to itself.");
    else if (!redirectStatusChoices.some((status) => status === row.status)) {
      refuse("The status must be 301 or 302.");
    } else if (active.some((other) => other.from_path === from && other.id !== row.id)) {
      refuse("That old address is already redirected.");
    } else if (closesLoop(row, active)) refuse("These addresses would redirect in a loop.");
  });
}
