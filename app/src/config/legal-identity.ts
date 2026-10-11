/**
 * The legal identity of Matter of Place (ruling H83): a product of Omnikom LLC, at one postal address.
 *
 * It lives in a file of its own, with no import and no read of the environment, because the job runner loads the
 * invoice and the reel under Deno, where `site.ts` fails on `import.meta.env`. Every surface that names the company
 * reads these two values (directly on the server, through `siteConfig` on the site), so the name is typed once.
 * `settings.site.legal` overrides them on the pages; they are what shows while those rows are empty.
 */
export const parentCompany = "Omnikom LLC";

export const legalAddress = "30 N Gould St Ste R, Sheridan, WY 82801, USA";

/** The credit line of the footer and the invoice: "A product of Omnikom LLC." */
export const productLine = `A product of ${parentCompany}.`;
