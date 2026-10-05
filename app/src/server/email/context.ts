import { z } from "zod";
import { emptySiteSettings, siteSettingsSchema, type SiteSettings } from "../../domain/settings.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { readVar } from "../lib/runtime-env.ts";

// What every email needs from the world outside its template row: the site origin its links are built on and the
// identity of the business. Variables are read at call time through `readVar`, never through `env.ts`, because the
// job runner has no `env.ts` (G39).

/** The origin that `confirm_url` and `link_url` are built on, and the identity lines of the footer; nulls when unset. */
export interface SiteContext {
  siteUrl: string;
  entity: string | null;
  address: string | null;
  contact: { email: string | null };
}

const notifications = z.object({ recipients: z.array(z.string().email()).default([]) });

export async function readSettings(db: Db, keys: string[]): Promise<Map<string, unknown>> {
  const { data, error } = await db.from("settings").select("key, value").in("key", keys);
  if (error !== null) throw new Error(`settings_read_failed:${error.code}`);
  return new Map(data.map((row) => [row.key, row.value]));
}

// A malformed `settings.site` reads as unset: an email still goes out, only without its identity lines.
export const siteOf = (settings: Map<string, unknown>): SiteSettings =>
  siteSettingsSchema.safeParse(settings.get("site")).data ?? emptySiteSettings;

/** `siteUrl` is the argument when given (the Worker passes its public origin), else the function secret `SITE_URL`. */
export async function loadSiteContext(db: Db, siteUrl?: string): Promise<SiteContext> {
  const origin = siteUrl ?? readVar("SITE_URL");
  if (origin === undefined || origin === "") throw new NonRetryableError("site_url_missing");
  const site = siteOf(await readSettings(db, ["site"]));
  return {
    siteUrl: origin.replace(/\/+$/, ""),
    entity: site.legal.entity,
    address: site.legal.address,
    contact: { email: site.contact.email },
  };
}

/** Who hears an alert: the notification list, then the public contact address, then `ADMIN_NOTIFY_EMAIL`. */
export async function resolveAdminRecipients(db: Db): Promise<string[]> {
  const settings = await readSettings(db, ["notifications", "site"]);
  const listed = notifications.safeParse(settings.get("notifications")).data?.recipients ?? [];
  if (listed.length > 0) return listed;
  const fallback = siteOf(settings).contact.email ?? readVar("ADMIN_NOTIFY_EMAIL");
  if (fallback === undefined || fallback === "") throw new NonRetryableError("recipient_missing");
  return [fallback];
}
