import { siteConfig } from "../../config/site";
import { seedOfferings } from "../../data/exposure";
import { plansFromOfferings } from "../../domain/exposure";
import type { SiteService } from "../types";

// Local mode shows the bundled illustrative catalog, so the site says so (invariant 6), and the seed plans.
export const localSite: SiteService = {
  get: () =>
    Promise.resolve({
      contact: {
        email: siteConfig.contact.email,
        phone: siteConfig.contact.phone,
        privacy_email: null,
      },
      legal: { entity: siteConfig.legal.entity, address: siteConfig.legal.address },
      social: { instagram: siteConfig.social.instagram, x: null, linkedin: null },
      illustrativeContent: true,
      products: plansFromOfferings(seedOfferings),
    }),
};
