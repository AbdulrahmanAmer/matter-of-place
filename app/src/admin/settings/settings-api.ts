import {
  comingSoonPutInput,
  invoicePutInput,
  notificationsPutInput,
  redirectArchivedSchema,
  redirectPageSchema,
  redirectRowSchema,
  settingsAnswerSchema,
  type InvoiceSettings,
  type NotificationsInput,
  type RedirectPutInput,
} from "../../domain/admin-settings";
import { siteSettingsSchema, type SiteSettings } from "../../domain/settings";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 24. Components reach these through `settings-queries.ts`.

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchSettings() {
  return adminFetch("/api/admin/settings", settingsAnswerSchema);
}

export function putSite(site: SiteSettings) {
  return adminFetch("/api/admin/settings/site", siteSettingsSchema, send("PUT", site));
}

export function putInvoice(invoice: InvoiceSettings) {
  return adminFetch("/api/admin/settings/invoice", invoicePutInput, send("PUT", invoice));
}

export function putComingSoon(comingSoon: boolean) {
  return adminFetch(
    "/api/admin/settings/coming-soon",
    comingSoonPutInput,
    send("PUT", { coming_soon_global: comingSoon }),
  );
}

export function putNotifications(input: NotificationsInput) {
  return adminFetch("/api/admin/settings/notifications", notificationsPutInput, send("PUT", input));
}

/** One page of active redirects; `cursor` is the `next_cursor` of the page before. */
export function fetchRedirects(cursor: string | null) {
  const search = cursor === null ? "" : `?${new URLSearchParams({ cursor }).toString()}`;
  return adminFetch(`/api/admin/settings/redirects${search}`, redirectPageSchema);
}

export function putRedirect(input: RedirectPutInput) {
  return adminFetch("/api/admin/settings/redirects", redirectRowSchema, send("PUT", input));
}

export function archiveRedirect(id: string) {
  return adminFetch(
    "/api/admin/settings/redirects",
    redirectArchivedSchema,
    send("DELETE", { id }),
  );
}
