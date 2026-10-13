/**
 * Site-wide configuration.
 *
 * Values that depend on the deployment (origins, API base) come from `VITE_*`
 * environment variables. Values that depend on the business (contact details,
 * registered entity, social profiles) live in `settings.site`; the nulls here are
 * the local-mode default, so no page ever shows an invented address or telephone number.
 */
import { legalAddress, parentCompany } from "./legal-identity";

const env = import.meta.env;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const siteConfig = {
  name: "Matter of Place",
  tagline: "Exceptional property. Properly considered.",
  description:
    "An editorial real-estate media platform for exceptional residential property in California, New York and Florida.",
  url: trimTrailingSlash(env.VITE_SITE_URL ?? "https://matterofplace.com"),
  apiBaseUrl: env.VITE_API_BASE_URL ? trimTrailingSlash(env.VITE_API_BASE_URL) : null,
  parentCompany,
  /** The postal address the pages print while `settings.site.legal.address` is empty (ruling H83). */
  legalAddress,
  locale: "en-US",
  social: {
    instagram: null as string | null,
    x: null as string | null,
    linkedin: null as string | null,
  },
  contact: {
    email: null as string | null,
    phone: null as string | null,
  },
  legal: {
    entity: null as string | null,
    address: null as string | null,
  },
} as const;

/** The date of the last edit of the legal copy, shown as "Last updated" on the accessibility statement. */
export const legalUpdated = "2026-10-13";

/**
 * The version of each legal text, an ISO date. `terms` is what a submitter's rights confirmation records
 * (`currentRightsVersion`), so editing the terms adds a new version here and a new entry in
 * `tests/unit/fixtures/legal-hashes.json`.
 */
export const legalVersions = { privacy: "2026-10-13", terms: "2026-10-11" } as const;

/** Absolute URL for a site path, used in canonical links and structured data. */
export const absoluteUrl = (path: string) =>
  `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
