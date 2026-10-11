// Ruling H83: Matter of Place is a product of Omnikom LLC, at 30 N Gould St Ste R, Sheridan, WY 82801, USA. The code
// carries both whether or not the settings rows are filled, and every line that names the company derives from the one
// constant (`src/config/legal-identity.ts`), so none keeps a second literal.
import { describe, expect, it } from "vitest";
import { legalAddress, parentCompany, productLine } from "../../src/config/legal-identity";
import { siteConfig } from "../../src/config/site";
import { legalIdentity } from "../../src/lib/legal-identity";
import { pageDescription } from "../../src/lib/seo-copy";
import { t } from "../../src/lib/strings";
import { reelCopy } from "../../src/server/assets/reel-spec";
import { layoutInvoice } from "../../src/server/payments/invoice-layout";
import { invoiceSnapshot } from "../fixtures/invoice-snapshot";
import fixture from "../../../launch/reel/fixture-spec.json";

describe("the legal identity the code carries", () => {
  it("is Omnikom LLC at the Sheridan address of ruling H83", () => {
    expect(siteConfig.parentCompany).toBe("Omnikom LLC");
    expect(siteConfig.legalAddress).toBe("30 N Gould St Ste R, Sheridan, WY 82801, USA");
    expect([parentCompany, legalAddress]).toEqual([
      siteConfig.parentCompany,
      siteConfig.legalAddress,
    ]);
  });

  it("fills only what the settings leave empty, the entity and the address on their own", () => {
    expect(legalIdentity({ entity: null, address: null })).toEqual({
      entity: "Omnikom LLC",
      address: legalAddress,
    });
    expect(legalIdentity({ entity: "  ", address: "1 Test Street" })).toEqual({
      entity: "Omnikom LLC",
      address: "1 Test Street",
    });
    expect(legalIdentity({ entity: "Example Test LLC", address: null })).toEqual({
      entity: "Example Test LLC",
      address: legalAddress,
    });
  });

  it("is the one source of the footer line, the credit line and the about description", () => {
    expect(t.footer.line).toBe(productLine);
    expect(productLine).toBe(`A product of ${siteConfig.parentCompany}.`);
    expect(pageDescription("about")).toContain(`A product of ${siteConfig.parentCompany}.`);
  });

  it("is the credit the reel draws, without the final full stop", () => {
    expect(reelCopy(fixture.property).credit).toBe(`A product of ${siteConfig.parentCompany}`);
  });

  it("is the line under the wordmark on an invoice", async () => {
    const runs = await layoutInvoice(invoiceSnapshot());
    expect(runs.map((run) => run.text)).toContain(productLine);
  });
});
