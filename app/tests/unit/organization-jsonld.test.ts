import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "../../src/config/site";
import { emptySiteSettings, type SiteSettings } from "../../src/domain/settings";
import { organizationJsonLd } from "../../src/lib/seo";

const full: SiteSettings = {
  contact: { email: "hello@example.com", phone: "+1 212 555 0100", privacy_email: null },
  legal: { entity: "Matter of Place LLC", address: "1 Example Street, New York, NY 10001" },
  social: {
    instagram: "https://instagram.com/matterofplace",
    x: "https://x.com/matterofplace",
    linkedin: "https://linkedin.com/company/matterofplace",
  },
};

describe("organizationJsonLd", () => {
  it("with nothing set, holds the brand fields and the parent and no key for a null leaf", () => {
    const node = organizationJsonLd(emptySiteSettings);
    expect(node).toEqual({
      "@type": "Organization",
      "@id": absoluteUrl("/#organization"),
      name: siteConfig.name,
      url: siteConfig.url,
      description: siteConfig.description,
      parentOrganization: { "@type": "Organization", name: "Omnikom" },
    });
    expect(JSON.stringify(node)).not.toContain("null");
  });

  it("adds legalName, email, telephone and the address as a PostalAddress when they are set", () => {
    const node = organizationJsonLd(full);
    expect(node).toMatchObject({
      legalName: "Matter of Place LLC",
      email: "hello@example.com",
      telephone: "+1 212 555 0100",
      address: { "@type": "PostalAddress", streetAddress: "1 Example Street, New York, NY 10001" },
    });
  });

  it("adds legalName alone when only the entity is set", () => {
    const node = organizationJsonLd({
      ...emptySiteSettings,
      legal: { entity: "Matter of Place LLC", address: null },
    });
    expect(node).toHaveProperty("legalName", "Matter of Place LLC");
    expect(node).not.toHaveProperty("address");
    expect(node).not.toHaveProperty("email");
    expect(node).not.toHaveProperty("telephone");
  });

  it("holds in sameAs only the social addresses that are set, in order", () => {
    const node = organizationJsonLd({
      ...emptySiteSettings,
      social: { instagram: full.social.instagram, x: null, linkedin: full.social.linkedin },
    });
    expect(node.sameAs).toEqual([full.social.instagram, full.social.linkedin]);
  });

  it("leaves sameAs out when no social address is set", () => {
    expect(organizationJsonLd(emptySiteSettings)).not.toHaveProperty("sameAs");
  });

  it("names Omnikom as the parent whatever is set", () => {
    for (const site of [emptySiteSettings, full]) {
      expect(organizationJsonLd(site).parentOrganization).toEqual({
        "@type": "Organization",
        name: "Omnikom",
      });
    }
  });

  it("carries no logo", () => {
    expect(organizationJsonLd(full)).not.toHaveProperty("logo");
  });
});
