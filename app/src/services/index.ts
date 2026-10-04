import { siteConfig } from "../config/site";
import { createHttpServices } from "./http";
import { localCatalog } from "./local/catalog";
import { localConcierge } from "./local/concierge";
import { localInquiries, localNewsletter, localSubmissions } from "./local/outbox";
import { localSearch } from "./local/search";
import type { Services } from "./types";

export type { ConciergeAnswer, SearchMatch, Services, UploadProgress } from "./types";
export { ServiceError } from "./types";

const localServices: Services = {
  mode: "local",
  catalog: localCatalog,
  inquiries: localInquiries,
  submissions: localSubmissions,
  newsletter: localNewsletter,
  search: localSearch,
  concierge: localConcierge,
};

/**
 * The single entry point for data and delivery. Set `VITE_API_BASE_URL` and
 * every page, form and search reads from and writes to the API; leave it
 * unset and the site runs entirely from bundled content.
 */
export const services: Services = siteConfig.apiBaseUrl
  ? { mode: "live", ...createHttpServices(siteConfig.apiBaseUrl) }
  : localServices;

export const isLive = services.mode === "live";
