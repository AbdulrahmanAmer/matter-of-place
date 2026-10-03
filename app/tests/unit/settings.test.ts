import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retentionPeriods } from "../../src/domain/retention";
import {
  emptySiteSettings,
  presentLines,
  privacyLines,
  siteFieldSpecs,
  siteSettingsSchema,
} from "../../src/domain/settings";

const SEED_SQL = readFileSync(
  new URL("../../supabase/migrations/20261001091100_settings_defaults.sql", import.meta.url),
  "utf8",
);

const allSet = {
  contact: {
    email: "hello@example.test",
    phone: "+1 310 555 0100",
    privacy_email: "p@example.test",
  },
  legal: { entity: "Example Holdings LLC", address: "1 Example Way\nLos Angeles, CA 90001" },
  social: {
    instagram: "https://www.instagram.com/example",
    x: "https://x.com/example",
    linkedin: "https://www.linkedin.com/company/example",
  },
};

const rejected = (value: unknown): boolean => !siteSettingsSchema.safeParse(value).success;
const contact = (leaves: Record<string, unknown>) => ({ contact: leaves });
const social = (leaves: Record<string, unknown>) => ({ social: leaves });

describe("siteSettingsSchema", () => {
  it("turns blank strings into null and trims the rest", () => {
    const parsed = siteSettingsSchema.parse({
      contact: { email: "  ", phone: "", privacy_email: "  p@example.test " },
      legal: { entity: " Example Holdings LLC ", address: "\n" },
    });
    expect(parsed.contact).toEqual({ email: null, phone: null, privacy_email: "p@example.test" });
    expect(parsed.legal).toEqual({ entity: "Example Holdings LLC", address: null });
  });

  it("parses B2's seeded object to the full shape, every other leaf null", () => {
    const literal = /'(\{"contact".*?\})'::jsonb/.exec(SEED_SQL)?.[1];
    expect(literal).toBeDefined();
    expect(siteSettingsSchema.parse(JSON.parse(literal ?? "{}"))).toEqual({
      contact: {
        email: "hello@matterofplace.com",
        phone: null,
        privacy_email: "privacy@matterofplace.com",
      },
      legal: { entity: null, address: null },
      social: { instagram: null, x: null, linkedin: null },
    });
  });

  it("fills a partial or empty object with nulls", () => {
    const nulls = {
      contact: { email: null, phone: null, privacy_email: null },
      legal: { entity: null, address: null },
      social: { instagram: null, x: null, linkedin: null },
    };
    expect(siteSettingsSchema.parse({})).toEqual(nulls);
    expect(emptySiteSettings).toEqual(nulls);
    expect(siteSettingsSchema.parse(contact({ email: "hello@example.test" }))).toEqual({
      ...nulls,
      contact: { ...nulls.contact, email: "hello@example.test" },
    });
  });

  it("accepts a fully set object unchanged", () => {
    expect(siteSettingsSchema.parse(allSet)).toEqual(allSet);
  });

  it("needs a valid email of at most 254 characters", () => {
    expect(rejected(contact({ email: "not an email" }))).toBe(true);
    expect(rejected(contact({ privacy_email: "a@b" }))).toBe(true);
    expect(rejected(contact({ email: `${"a".repeat(250)}@b.co` }))).toBe(true);
    expect(rejected(contact({ email: "hello@example.test" }))).toBe(false);
  });

  it("needs a phone of 6 to 30 characters with a digit", () => {
    expect(rejected(contact({ phone: "call me maybe" }))).toBe(true);
    expect(rejected(contact({ phone: "12345" }))).toBe(true);
    expect(rejected(contact({ phone: `1${" ".repeat(10)}${"0".repeat(20)}` }))).toBe(true);
    expect(rejected(contact({ phone: "+1 (310) 555-0100" }))).toBe(false);
  });

  it("bounds the entity and the address and allows line breaks", () => {
    expect(rejected({ legal: { entity: "ab" } })).toBe(true);
    expect(rejected({ legal: { entity: "a".repeat(201) } })).toBe(true);
    expect(rejected({ legal: { address: "1 Way" } })).toBe(false);
    expect(rejected({ legal: { address: "1 Way" + "a".repeat(396) } })).toBe(true);
    expect(siteSettingsSchema.parse(allSet).legal.address).toContain("\n");
  });

  it("takes an Instagram address only as https on instagram.com", () => {
    expect(rejected(social({ instagram: "http://www.instagram.com/example" }))).toBe(true);
    expect(rejected(social({ instagram: "https://example.com/instagram.com/x" }))).toBe(true);
    expect(rejected(social({ instagram: "https://instagram.com.evil.test/example" }))).toBe(true);
    expect(rejected(social({ instagram: "https://notinstagram.com/example" }))).toBe(true);
    expect(rejected(social({ instagram: "https://u:p@instagram.com/example" }))).toBe(true);
    expect(rejected(social({ instagram: "https://instagram.com" }))).toBe(true);
    expect(rejected(social({ instagram: "@example" }))).toBe(true);
    expect(rejected(social({ instagram: "https://instagram.com/example" }))).toBe(false);
  });

  it("takes X only on x.com and LinkedIn only under /company/", () => {
    expect(rejected(social({ x: "https://twitter.com/example" }))).toBe(true);
    expect(rejected(social({ x: "https://x.com/example" }))).toBe(false);
    expect(rejected(social({ linkedin: "https://www.linkedin.com/in/example" }))).toBe(true);
    expect(rejected(social({ linkedin: "https://www.linkedin.com/company/" }))).toBe(true);
    expect(rejected(social({ linkedin: "https://www.linkedin.com/company/example" }))).toBe(false);
  });
});

describe("presentLines", () => {
  it("yields no line for an all-null site", () => {
    expect(presentLines(...Object.values(emptySiteSettings.legal))).toEqual([]);
    expect(presentLines(null, undefined, "", "  \n ")).toEqual([]);
  });

  it("yields the set values trimmed and in order", () => {
    expect(presentLines(" Example Holdings LLC ", null, "1 Example Way")).toEqual([
      "Example Holdings LLC",
      "1 Example Way",
    ]);
  });
});

describe("privacyLines", () => {
  const site = (email: string | null, privacy: string | null) =>
    siteSettingsSchema.parse(contact({ email, privacy_email: privacy }));

  it("prints the privacy email when set", () => {
    expect(privacyLines(site("hello@example.test", "p@example.test"))).toEqual(["p@example.test"]);
  });

  it("falls back to the contact email", () => {
    expect(privacyLines(site("hello@example.test", null))).toEqual(["hello@example.test"]);
  });

  it("yields no line when both are null", () => {
    expect(privacyLines(site(null, null))).toEqual([]);
  });
});

describe("siteFieldSpecs", () => {
  const leafKeys = Object.entries(emptySiteSettings).flatMap(([group, leaves]) =>
    Object.keys(leaves).map((name) => `${group}.${name}`),
  );

  it("name every leaf of the schema once", () => {
    expect(siteFieldSpecs.map((spec) => spec.key).sort()).toEqual(leafKeys.sort());
  });

  it("require the three launch fields and no others", () => {
    expect(siteFieldSpecs.filter((spec) => spec.required).map((spec) => spec.key)).toEqual([
      "contact.email",
      "legal.entity",
      "legal.address",
    ]);
  });
});

describe("retentionPeriods", () => {
  it("give each key exactly one unit", () => {
    expect(Object.values(retentionPeriods).map((period) => Object.keys(period).length)).toEqual(
      Object.keys(retentionPeriods).map(() => 1),
    );
  });
});
