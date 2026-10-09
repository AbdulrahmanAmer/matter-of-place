import {
  comingSoonPutInput,
  invoicePutInput,
  notificationsPutInput,
  settingsAnswerSchema,
  type NotificationsInput,
} from "../../domain/admin-settings";
import type { InvoiceSettings } from "../../domain/payments";
import { siteSettingsSchema, type SiteSettings } from "../../domain/settings";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 24. Components reach these through `settings-queries.ts`.

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchSettings() {
  return adminFetch("/api/admin/settings", settingsAnswerSchema);
}

export function putSite(site: SiteSettings) {
  return adminFetch("/api/admin/settings/site", siteSettingsSchema, put(site));
}

export function putInvoice(invoice: InvoiceSettings) {
  return adminFetch("/api/admin/settings/invoice", invoicePutInput, put(invoice));
}

export function putComingSoon(comingSoon: boolean) {
  return adminFetch(
    "/api/admin/settings/coming-soon",
    comingSoonPutInput,
    put({ coming_soon_global: comingSoon }),
  );
}

export function putNotifications(input: NotificationsInput) {
  return adminFetch("/api/admin/settings/notifications", notificationsPutInput, put(input));
}
