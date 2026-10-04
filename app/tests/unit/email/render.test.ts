import { describe, expect, it } from "vitest";
import {
  emailBlockSchema,
  emailClasses,
  emailSettingsSchema,
  emailTemplateKeys,
  emailTemplateSchema,
  sampleVariables,
  usedVariables,
  variablesByKey,
  type EmailBlock,
} from "../../../src/domain/email";

const accepted = (value: unknown): boolean => emailBlockSchema.safeParse(value).success;

describe("email blocks", () => {
  it("accepts each block type", () => {
    expect(accepted({ type: "heading", text: "Hello", level: 2 })).toBe(true);
    expect(accepted({ type: "paragraph", text: "Hello {{name}}" })).toBe(true);
    expect(accepted({ type: "button", label: "Open", url: "{{confirm_url}}" })).toBe(true);
    expect(accepted({ type: "button", label: "Open", url: "https://matterofplace.com" })).toBe(
      true,
    );
    expect(accepted({ type: "facts", rows: [{ label: "City", value: "{{city}}" }] })).toBe(true);
    expect(accepted({ type: "signature" })).toBe(true);
  });

  it("refuses an unknown type, empty text and an unsafe link", () => {
    expect(accepted({ type: "image", src: "https://matterofplace.com/a.png" })).toBe(false);
    expect(accepted({ type: "paragraph", text: "" })).toBe(false);
    expect(accepted({ type: "button", label: "Open", url: "javascript:alert(1)" })).toBe(false);
    expect(accepted({ type: "button", label: "Open", url: "http://matterofplace.com" })).toBe(
      false,
    );
    expect(accepted({ type: "facts", rows: [] })).toBe(false);
    expect(accepted({ type: "heading", text: "Hello", level: 4 })).toBe(false);
  });
});

describe("emailTemplateSchema", () => {
  const row = {
    key: "received",
    subject: "We have your request",
    preheader: "Next steps",
    body: [{ type: "paragraph", text: "Hello {{submitter_name}}" }],
    variables: ["submitter_name"],
    enabled: true,
    version: 1,
    class: "transactional",
  };

  it("takes a row and requires its class", () => {
    expect(emailTemplateSchema.safeParse(row).success).toBe(true);
    expect(emailTemplateSchema.safeParse({ ...row, class: undefined }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...row, class: "marketing" }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...row, key: "unknown" }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...row, preheader: "x".repeat(111) }).success).toBe(
      false,
    );
  });

  it("names the three send classes", () => {
    expect(emailClasses).toEqual(["transactional", "alert", "bulk"]);
  });
});

describe("emailSettingsSchema", () => {
  const share = {
    daily_cap: 15,
    bulk_cap: 5,
    monthly_cap: 300,
    dev_recipients: ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"],
  };

  it("takes both shares of invariant 5", () => {
    expect(emailSettingsSchema.safeParse(share).success).toBe(true);
    const live = { daily_cap: 75, bulk_cap: 50, monthly_cap: 2600, dev_recipients: [] };
    expect(emailSettingsSchema.safeParse(live).success).toBe(true);
  });

  it("keeps the bulk ceiling under the daily one and refuses a malformed pattern", () => {
    expect(emailSettingsSchema.safeParse({ ...share, bulk_cap: 15 }).success).toBe(false);
    expect(
      emailSettingsSchema.safeParse({ ...share, dev_recipients: ["Admin@x.com"] }).success,
    ).toBe(false);
    expect(
      emailSettingsSchema.safeParse({ ...share, dev_recipients: ["no-at-sign"] }).success,
    ).toBe(false);
  });
});

describe("usedVariables", () => {
  it("lists each variable once, in order of first use, across every block field", () => {
    const body: EmailBlock[] = [
      { type: "heading", text: "Hello {{submitter_name}}" },
      { type: "paragraph", text: "{{property_address}} in {{city}}, {{city}}" },
      { type: "button", label: "Open {{package}}", url: "{{link_url}}" },
      { type: "facts", rows: [{ label: "State", value: "{{state}} {{submitter_name}}" }] },
      { type: "signature", text: "{{signed_by}}" },
    ];
    expect(usedVariables(body)).toEqual([
      "submitter_name",
      "property_address",
      "city",
      "package",
      "link_url",
      "state",
      "signed_by",
    ]);
  });

  it("ignores braces that are not a plain variable", () => {
    const body: EmailBlock[] = [
      { type: "paragraph", text: "{{ spaced }} {{a.b}} {{}} {single} {{ok_1}}" },
      { type: "signature" },
    ];
    expect(usedVariables(body)).toEqual(["ok_1"]);
  });
});

describe("sample variables", () => {
  it.each(emailTemplateKeys)("%s has a sample for exactly its variables", (key) => {
    expect(Object.keys(sampleVariables(key)).sort()).toEqual([...variablesByKey[key]].sort());
  });

  it("builds every sample URL on the site given", () => {
    const samples = sampleVariables("admin_notify", "https://dev.example.invalid");
    expect(samples["link_url"]).toMatch(/^https:\/\/dev\.example\.invalid\//);
    expect(sampleVariables("repermission")["confirm_url"]).toMatch(
      /^https:\/\/matterofplace\.com\/api\/public\/subscribers\/confirm\?token=/,
    );
  });

  it("holds no em dash and no unreplaced variable", () => {
    for (const key of emailTemplateKeys) {
      for (const value of Object.values(sampleVariables(key))) {
        expect(value).not.toMatch(/—|\{\{/);
      }
    }
  });
});
