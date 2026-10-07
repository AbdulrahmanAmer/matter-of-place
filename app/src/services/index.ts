import { createHttpServices } from "./http";
import { localCatalog } from "./local/catalog";
import { localConcierge } from "./local/concierge";
import { localInquiries, localNewsletter, localSubmissions } from "./local/outbox";
import { localSearch } from "./local/search";
import { localSite } from "./local/site";
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
  site: localSite,
};

/**
 * The single entry point for data and delivery. Set `VITE_API_BASE_URL` and
 * every page, form and search reads from and writes to the API; leave it
 * unset and the site runs entirely from bundled content. The build replaces the
 * literal `import.meta.env.VITE_API_BASE_URL` with its value, so a live build drops
 * the local adapters and the bundled catalog with them (FE-03).
 */
export const services: Services = import.meta.env.VITE_API_BASE_URL
  ? { mode: "live", ...createHttpServices(import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")) }
  : localServices;

export const isLive = services.mode === "live";
