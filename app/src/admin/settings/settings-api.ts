import {
  comingSoonPutInput,
  invoicePutInput,
  notificationsPutInput,
  productsPreviewSchema,
  redirectArchivedSchema,
  redirectPageSchema,
  redirectRowSchema,
  settingsAnswerSchema,
  type InvoiceSettings,
  type NotificationsInput,
  type RedirectPutInput,
} from "../../domain/admin-settings";
import { productsSettingSchema, type ProductsSetting } from "../../domain/exposure";
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

export function putProducts(products: ProductsSetting) {
  return adminFetch("/api/admin/settings/products", productsSettingSchema, send("PUT", products));
}

/** The dry run of the plans: nothing is written. */
export function previewProducts(products: ProductsSetting) {
  return adminFetch(
    "/api/admin/settings/products/preview",
    productsPreviewSchema,
    send("POST", products),
  );
}

/**
 * One page of active redirects (`cursor` is the `next_cursor` of the page before), one page of old property
 * addresses (`old_cursor`), and, when `path` is typed, where that path leads.
 */
export function fetchRedirects(request: {
  cursor: string | null;
  oldCursor: string | null;
  path: string | null;
}) {
  const query = new URLSearchParams();
  if (request.cursor !== null) query.set("cursor", request.cursor);
  if (request.oldCursor !== null) query.set("old_cursor", request.oldCursor);
  if (request.path !== null) query.set("path", request.path);
  const search = query.size === 0 ? "" : `?${query.toString()}`;
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
