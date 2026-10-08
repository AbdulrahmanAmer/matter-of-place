import { z } from "zod";
import type { Tables } from "../db/index.ts";

// Transactional and notification email (B5). A template is a row of `email_templates`: its columns, this schema and
// the API JSON are the same names (G-004). The React files under `src/templates/email` supply layout and the seed
// defaults; what is sent is always the row. This file is loaded by the Deno job runner, so imports carry `.ts`.

/** One send class per template; it decides the daily ceiling and is written as `email_messages.kind`. */
export const emailClasses = ["transactional", "alert", "bulk"] as const;

/** B5's keys. Later slices append theirs and seed their rows in the same commit (G46). */
export const emailTemplateKeys = [
  "received",
  "declined",
  "accepted",
  "awaiting_assets",
  "invoice",
  "inquiry_ack",
  "inquiry_forward",
  "interest_confirm",
  "newsletter_confirm",
  "admin_notify",
  "standalone",
  "subject_ack",
  "repermission",
  "market_open",
  "campaign_report",
] as const;

export type EmailTemplateKey = (typeof emailTemplateKeys)[number];

const VARIABLE = "[A-Za-z0-9_]+";
const variableName = z
  .string()
  .regex(new RegExp(`^${VARIABLE}$`), "Letters, digits and underscore");

const text = (max: number) => z.string().min(1).max(max);

const isLink = (value: string): boolean =>
  /^(https:\/\/|mailto:)/.test(value) || new RegExp(`^\\{\\{${VARIABLE}\\}\\}$`).test(value);

/**
 * Block model (architecture 3.5). Text and URLs may hold `{{variable}}`: letters, digits and underscore only, no
 * expressions. A block whose interpolated text is empty is dropped when the email is rendered.
 */
export const emailBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: text(200),
    level: z.number().int().min(1).max(3).optional(),
  }),
  z.object({ type: z.literal("paragraph"), text: text(4000) }),
  z.object({
    type: z.literal("button"),
    label: text(80),
    url: z
      .string()
      .max(2000)
      .refine(isLink, "Use an https address, a mailto address or a variable"),
  }),
  z.object({
    type: z.literal("facts"),
    rows: z
      .array(z.object({ label: text(80), value: text(500) }))
      .min(1)
      .max(12),
  }),
  z.object({ type: z.literal("signature"), text: text(200).optional() }),
]);

export type EmailBlock = z.infer<typeof emailBlockSchema>;

export const emailTemplateSchema = z.object({
  key: z.enum(emailTemplateKeys),
  subject: text(200),
  preheader: z.string().max(110),
  // A row may hold no blocks when its template file draws its own content (`standalone`); `renderTemplate` refuses an
  // empty body for every other key.
  body: z.array(emailBlockSchema).max(40),
  variables: z.array(variableName).max(40),
  enabled: z.boolean(),
  version: z.number().int().min(1),
  class: z.enum(emailClasses),
});

/** A row of `email_templates` as the database returns it (G-004). */
export type EmailTemplateRow = Tables<"email_templates">;

const devPattern = z
  .string()
  .regex(
    /^[a-z0-9._+*-]+@[a-z0-9.-]+\.[a-z]{2,}$/,
    "Lowercase address; * stands for any run before the @",
  );

/**
 * `settings.email`, the share of the one Resend account that the current stage may use (invariant 5). The bulk
 * ceiling stays under the daily one, so a market opening never pushes an invoice to the next day.
 */
export const emailSettingsSchema = z
  .object({
    daily_cap: z.number().int().min(1),
    bulk_cap: z.number().int().min(0),
    monthly_cap: z.number().int().min(1),
    dev_recipients: z.array(devPattern).max(50),
  })
  .refine((value) => value.bulk_cap < value.daily_cap, {
    message: "The bulk ceiling must stay under the daily ceiling",
    path: ["bulk_cap"],
  });

/** The variables each template may use; the key table of B5's contract. */
export const variablesByKey = {
  received: ["submitter_name", "property_address", "city", "state", "package"],
  declined: [
    "submitter_name",
    "property_address",
    "reason_label",
    "reason_paragraph",
    "note_paragraph",
  ],
  accepted: ["submitter_name", "property_address", "city", "state", "package"],
  awaiting_assets: ["submitter_name", "property_address", "assets_note"],
  invoice: [
    "submitter_name",
    "property_address",
    "invoice_number",
    "product",
    "amount",
    "terms",
    "preferred_method",
    "payment_instructions",
    "billing_email",
  ],
  inquiry_ack: ["name"],
  inquiry_forward: [
    "submitter_name",
    "property_title",
    "inquirer_name",
    "inquirer_contact",
    "message",
  ],
  interest_confirm: ["market_names", "confirm_url"],
  newsletter_confirm: ["confirm_url"],
  admin_notify: ["headline", "summary", "link_url"],
  standalone: ["subject", "preheader", "block"],
  subject_ack: ["kind_label", "due_date"],
  repermission: ["confirm_url"],
  market_open: ["market_name", "market_url"],
  campaign_report: [
    "property_name",
    "period",
    "impressions",
    "reach",
    "clicks",
    "video_views",
    "ctr",
  ],
} as const satisfies Record<EmailTemplateKey, readonly string[]>;

type VariableName = (typeof variablesByKey)[EmailTemplateKey][number];

const blockTexts = (block: EmailBlock): string[] => {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return [block.text];
    case "button":
      return [block.label, block.url];
    case "facts":
      return block.rows.flatMap((row) => [row.label, row.value]);
    case "signature":
      return block.text === undefined ? [] : [block.text];
  }
};

/** The distinct `{{variable}}` names of a body, in order of first appearance. */
export function usedVariables(body: readonly EmailBlock[]): string[] {
  const found = new Set<string>();
  for (const value of body.flatMap(blockTexts)) {
    for (const match of value.matchAll(new RegExp(`\\{\\{(${VARIABLE})\\}\\}`, "g"))) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

/** The property block of a standalone email: the `meta.block` of its asset with the address of its image. */
interface SampleBlock {
  title: string;
  deck: string;
  image_key: string;
  image_url: string;
  link: string;
}

const sampleValues = (siteUrl: string): Record<VariableName, string | SampleBlock> => ({
  submitter_name: "Jordan Lee",
  property_address: "412 Alder Court",
  city: "Pasadena",
  state: "California",
  package: "The Feature",
  reason_label: "Outside our current markets",
  reason_paragraph:
    "We publish existing homes in California, New York and Florida, and this one sits outside them.",
  note_paragraph: "We would be glad to look again if the details change.",
  assets_note: "Please send the exterior photographs when you can.",
  invoice_number: "MOP-0001",
  product: "The Feature",
  amount: "$295.00",
  terms: "Due within 14 days of the issue date.",
  preferred_method: "Bank transfer",
  payment_instructions: "The transfer details are on the attached invoice.",
  billing_email: "billing@matterofplace.com",
  name: "Jordan Lee",
  property_title: "Alder Court",
  inquirer_name: "Sam Rivera",
  inquirer_contact: "sam@example.com, +1 310 555 0100",
  message: "I would like to know more about the house.",
  market_names: "California and Florida",
  confirm_url: `${siteUrl}/api/public/subscribers/confirm?token=sample-token`,
  headline: "New request",
  summary: "New request: 412 Alder Court, Pasadena, California",
  link_url: `${siteUrl}/admin/requests/sample-request`,
  kind_label: "access",
  due_date: "November 18, 2026",
  market_name: "California",
  market_url: `${siteUrl}/california`,
  property_name: "Alder Court",
  period: "October 5, 2026 to October 11, 2026",
  impressions: "3,500",
  reach: "1,000",
  clicks: "42",
  video_views: "1,200",
  ctr: "1.2%",
  subject: "Alder Court, Pasadena",
  preheader: "A new property in California",
  block: {
    title: "Alder Court",
    deck: "A 1926 Spanish Revival house in Pasadena.",
    image_key: "sample/alder-court/og.jpg",
    image_url: `${siteUrl}/media/sample/alder-court/og.jpg`,
    link: `${siteUrl}/property/alder-court`,
  },
});

/** A value for every variable of `key`; every sample URL is built on `siteUrl`. */
export function sampleVariables(
  key: EmailTemplateKey,
  siteUrl = "https://matterofplace.com",
): Record<string, string | SampleBlock> {
  const samples = sampleValues(siteUrl);
  const names: readonly VariableName[] = variablesByKey[key];
  return Object.fromEntries(names.map((name) => [name, samples[name]]));
}
