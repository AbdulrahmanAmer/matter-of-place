import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
  type EmailTemplateKey,
} from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { interpolate, renderTemplate, type RenderRow } from "../../../src/server/email/render";
import { definitionRow, definitions } from "../../../src/templates/email/index";
import { themeHex } from "../../../src/templates/theme.gen";

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

  it("takes a row with no blocks, for a template file that draws its own content", () => {
    expect(emailTemplateSchema.safeParse({ ...row, key: "standalone", body: [] }).success).toBe(
      true,
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
        for (const text of typeof value === "string" ? [value] : Object.values(value)) {
          expect(text).not.toMatch(/—|\{\{/);
        }
      }
    }
  });
});

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

const fileOf = (key: EmailTemplateKey) => {
  const file = definitions.find((entry) => entry.definition.key === key);
  if (file === undefined) throw new Error(`no template file for ${key}`);
  return file.definition;
};

const renderSample = (key: EmailTemplateKey) =>
  renderTemplate(definitionRow(fileOf(key)), sampleVariables(key), site);

const row = (overrides: Partial<RenderRow>, body: EmailBlock[]): RenderRow => ({
  key: "received",
  subject: "Subject",
  preheader: "",
  body,
  ...overrides,
});

describe("template files", () => {
  it("has one file for every key of emailTemplateKeys", () => {
    const keys = definitions.map((entry) => entry.definition.key);
    expect([...keys].sort()).toEqual([...emailTemplateKeys].sort());
  });

  it.each(emailTemplateKeys)("%s declares its variables and uses no other", (key) => {
    const { subject, preheader, blocks, variables } = fileOf(key);
    expect(variables).toEqual(variablesByKey[key]);
    expect(blocks.map((block) => emailBlockSchema.safeParse(block).success)).not.toContain(false);
    const used = usedVariables([
      { type: "paragraph", text: `${subject} ${preheader}`.trim() },
      ...blocks,
    ]);
    expect(used.filter((name) => !variables.includes(name))).toEqual([]);
  });

  it("equals the row the seed migration inserts, key by key", () => {
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261005013009_email_templates_seed.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const sqlRow =
      /\(\s*'(\w+)', '(\w+)', '((?:[^']|'')*)', '((?:[^']|'')*)',\s*'(\[[\s\S]*?\])',\s*'\{([^}]*)\}',\s*(?:true|false)\s*\)/g;
    const unquote = (value: string | undefined): string => (value ?? "").replaceAll("''", "'");
    const seeded = [...sql.matchAll(sqlRow)].map(
      ([, key, kind, subject, preheader, body, variables]) => ({
        key: emailTemplateSchema.shape.key.parse(key),
        class: kind,
        subject: unquote(subject),
        preheader: unquote(preheader),
        blocks: emailTemplateSchema.shape.body.parse(JSON.parse(unquote(body))),
        variables: (variables ?? "").split(",").filter((name) => name !== ""),
      }),
    );
    // This migration seeds B5's thirteen keys; a later slice seeds its own keys in its own migration. B11 rewrites the
    // `standalone` row, which the next test compares with its file.
    expect(seeded).toHaveLength(13);
    for (const entry of seeded.filter((row) => row.key !== "standalone")) {
      const { key, class: kind, subject, preheader, blocks, variables } = fileOf(entry.key);
      expect({ key, class: kind, subject, preheader, blocks, variables: [...variables] }).toEqual(
        entry,
      );
    }
  });

  it("equals the standalone row the B11 migration sets, key by key", () => {
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261008141205_standalone_template.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const patch = z
      .object({
        subject: z.string(),
        preheader: z.string(),
        body: emailTemplateSchema.shape.body,
        enabled: z.literal(true),
      })
      .parse(JSON.parse(/'(\{"subject"[^']*\})'::jsonb/.exec(sql)?.[1] ?? "null"));
    const variables = (/set variables = '\{([^}]*)\}'/.exec(sql)?.[1] ?? "").split(",");
    const { subject, preheader, blocks, variables: declared } = fileOf("standalone");
    expect({ subject, preheader, blocks, variables: [...declared] }).toEqual({
      subject: patch.subject,
      preheader: patch.preheader,
      blocks: patch.body,
      variables,
    });
  });
});

describe("renderTemplate", () => {
  it.each(emailTemplateKeys)(
    "%s renders with its sample variables, with nothing unreplaced and no stray colour",
    async (key) => {
      const { subject, preheader, html, text } = await renderSample(key);
      // The one placeholder a template may leave is Resend's, which Resend fills at send time.
      const drawn = (part: string): string => part.replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "");
      for (const value of [subject, preheader, drawn(html), drawn(text)])
        expect(value).not.toMatch(/\{\{|—/);
      const colours = (html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((hex) => hex.toLowerCase());
      expect(colours.filter((hex) => !Object.values<string>(themeHex).includes(hex))).toEqual([]);
      expect(text).not.toMatch(/<[a-z/]/);
    },
  );

  it("draws a standalone email's property block and unsubscribe link only when it is given a block", async () => {
    const legal: SiteContext = {
      ...site,
      entity: "Omnikom Media LLC",
      address: "100 Ocean Drive, Miami, FL 33139",
    };
    const row = definitionRow(fileOf("standalone"));
    const samples = sampleVariables("standalone");
    const withBlock = await renderTemplate(row, samples, legal);
    expect(withBlock.html).toContain("A 1926 Spanish Revival house");
    expect(withBlock.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(withBlock.html).toContain("100 Ocean Drive, Miami, FL 33139");
    expect(withBlock.html.indexOf("Omnikom Media LLC")).toBeLessThan(
      withBlock.html.indexOf("RESEND_UNSUBSCRIBE_URL"),
    );
    const without = Object.fromEntries(
      Object.entries(samples).filter(([name]) => name !== "block"),
    );
    const bare = await renderTemplate(row, without, legal);
    expect(bare.html).not.toContain("RESEND_UNSUBSCRIBE_URL");
    expect(bare.html).not.toContain("Spanish Revival");
  });

  it("drops a block whose text comes out empty, and a fact with no value", async () => {
    const body: EmailBlock[] = [
      { type: "paragraph", text: "Kept" },
      { type: "paragraph", text: "{{note}}" },
      {
        type: "facts",
        rows: [
          { label: "Shown", value: "yes" },
          { label: "Hidden", value: "{{note}}" },
        ],
      },
      { type: "facts", rows: [{ label: "Alone", value: "{{note}}" }] },
    ];
    const { html, text } = await renderTemplate(row({}, body), { note: "" }, site);
    expect(html).toContain("Kept");
    expect(html).not.toMatch(/<p[^>]*><\/p>/);
    expect(html).toContain("Shown");
    expect(html).not.toMatch(/Hidden|Alone/);
    expect(text).not.toMatch(/Hidden|Alone/);
  });

  it("drops a button whose link comes out empty", async () => {
    const body: EmailBlock[] = [
      { type: "paragraph", text: "Kept" },
      { type: "button", label: "Open", url: "{{link}}" },
    ];
    const { html, text } = await renderTemplate(row({}, body), { link: "" }, site);
    expect(html).toContain("Kept");
    expect(html).not.toContain("Open");
    expect(text).not.toContain("Open");
  });

  it("refuses a link variable that leaves the site", async () => {
    const body: EmailBlock[] = [{ type: "button", label: "Go", url: "{{link}}" }];
    for (const link of [
      "https://evil.example/confirm",
      "http://matterofplace.com/confirm",
      "https://matterofplace.com.evil.example/confirm",
      "not a url",
    ]) {
      await expect(renderTemplate(row({}, body), { link }, site)).rejects.toThrow("url_off_site");
    }
    const sameSite = await renderTemplate(
      row({}, body),
      { link: "https://matterofplace.com/ok" },
      site,
    );
    expect(sameSite.html).toContain('href="https://matterofplace.com/ok"');
  });

  it("names a variable it was not given", async () => {
    expect(() => interpolate("Hello {{name}}", {})).toThrow("missing_variable:name");
    await expect(
      renderTemplate(row({ subject: "Hello {{name}}" }, [{ type: "signature" }]), {}, site),
    ).rejects.toThrow("missing_variable:name");
  });

  it("keeps a subject on one line and refuses a body that is not blocks", async () => {
    const one = await renderTemplate(
      row({ subject: "About {{address}}" }, [{ type: "signature" }]),
      { address: "412 Alder\r\nBcc: someone@example.com" },
      site,
    );
    expect(one.subject).toBe("About 412 Alder Bcc: someone@example.com");
    await expect(
      renderTemplate({ ...row({}, []), body: [{ type: "image" }] }, {}, site),
    ).rejects.toThrow("template_body_invalid");
  });

  it("writes a plain-text part with every button address and the footer", async () => {
    const { text } = await renderSample("newsletter_confirm");
    expect(text).toContain(
      "Confirm: https://matterofplace.com/api/public/subscribers/confirm?token=sample-token",
    );
    expect(text).toContain("Exceptional property. Properly considered.");
  });

  it("draws the identity lines of the footer only when the site settings hold them", async () => {
    const named = { ...site, entity: "Omnikom Media LLC", address: "1 Example Plaza, Pasadena" };
    const { html, text } = await renderTemplate(row({}, [{ type: "signature" }]), {}, named);
    expect(html).toContain("Omnikom Media LLC");
    expect(text).toContain("1 Example Plaza, Pasadena");
    const bare = await renderTemplate(row({}, [{ type: "signature" }]), {}, site);
    expect(bare.html).not.toContain("Omnikom");
  });

  it("renders a row whose key has no definition inside the plain layout", async () => {
    const { html } = await renderTemplate(
      row({ key: "no_such_key" }, [{ type: "paragraph", text: "Row text" }]),
      {},
      site,
    );
    expect(html).toContain("Row text");
    expect(html).toContain("apple-touch-icon.png");
  });

  it("renders the blocks of a row that differs from its definition inside the Email of its key", async () => {
    vi.resetModules();
    vi.doMock("../../../src/templates/email/index", () => ({
      definitions: [
        {
          definition: { key: "received" },
          Email: ({ blocks }: { blocks: EmailBlock[] }) =>
            createElement(
              "main",
              { id: "received-email" },
              blocks.map((block) => (block.type === "paragraph" ? block.text : "")),
            ),
        },
      ],
    }));
    const { renderTemplate: render } = await import("../../../src/server/email/render");
    const body: EmailBlock[] = [{ type: "paragraph", text: "Edited by the admin" }];
    const own = await render(row({ key: "received" }, body), {}, site);
    expect(own.html).toContain('id="received-email"');
    expect(own.html).toContain("Edited by the admin");
    const other = await render(row({ key: "declined" }, body), {}, site);
    expect(other.html).not.toContain("received-email");
    vi.doUnmock("../../../src/templates/email/index");
    vi.resetModules();
  });
});

describe("owner wording", () => {
  const submitterKeys = [
    "received",
    "declined",
    "accepted",
    "awaiting_assets",
    "invoice",
    "inquiry_forward",
    "campaign_report",
  ] as const;

  it.each(submitterKeys)("%s says nothing that depends on who submitted", async (key) => {
    const { subject, text } = await renderSample(key);
    expect(`${subject} ${text}`).not.toMatch(/\b(agent|listing|brokerage|client)s?\b/i);
  });
});
