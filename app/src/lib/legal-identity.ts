import { siteConfig } from "../config/site";
import { presentLines, type SiteSettings } from "../domain/settings";

/**
 * Who the pages name as the company and where it writes from: the entity and address saved in `settings.site.legal`
 * when they are set, otherwise the identity the code carries (ruling H83). The footer, /legal, /privacy, /terms and
 * /cookies read it, so an empty settings row never leaves a legal page without a party or an address.
 */
export function legalIdentity(legal: SiteSettings["legal"]): { entity: string; address: string } {
  return {
    entity: presentLines(legal.entity)[0] ?? siteConfig.parentCompany,
    address: presentLines(legal.address)[0] ?? siteConfig.legalAddress,
  };
}
