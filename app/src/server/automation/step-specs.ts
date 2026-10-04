import { z } from "zod";
import type { JsonObject, SideEffect } from "../jobs/types.ts";

// The 17 step types of architecture 5, each described once. The recipe editor reads `fields`, the planner reads
// `paramsSchema`, `heavy`, `local` and `maxAttempts`, and the step modules of the runner import the same values, so
// the three cannot disagree. A step type exists only here: admins cannot add one (S34, no workflow engine). A change
// to a params schema adds optional fields with defaults only (R30).

export const stepTypes = [
  "send_email",
  "notify_admin",
  "bump_catalog_version",
  "purge_cache",
  "render_variants",
  "render_cover",
  "render_carousel",
  "render_story",
  "render_reel",
  "write_captions",
  "build_newsletter_block",
  "post_meta",
  "post_x",
  "post_linkedin",
  "render_og_static",
  "queue_digest",
  "webhook_omnikom",
] as const;

export type StepType = (typeof stepTypes)[number];

type FieldKind = "text" | "number" | "select" | "multiselect" | "boolean";

interface StepField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  /** What the form shows and what the schema fills in when the key is absent. */
  default?: string | number | boolean | readonly string[];
  min?: number;
  max?: number;
  hint?: string;
}

export interface StepSpec {
  type: StepType;
  label: string;
  description: string;
  heavy: boolean;
  /** The third execution class (ruling H34 (2)): planned like any step, claimed only by the laptop runner. */
  local?: boolean;
  paramsSchema: z.ZodObject<z.ZodRawShape, z.UnknownKeysParam, z.ZodTypeAny, JsonObject, unknown>;
  fields: readonly StepField[];
  /** Absent keeps the job default, `defaultMaxAttempts`; 12 for a step that calls an outside provider (DL-10). */
  maxAttempts?: number;
  /** Absent keeps the runner's own limit of 20000 ms; a `local` step has none. */
  timeoutMs?: number;
  sideEffect: SideEffect;
}

export const defaultMaxAttempts = 5;
const providerMaxAttempts = 12;

export const ogStaticPages = [
  "home",
  "markets",
  "market-california",
  "market-new-york",
  "market-florida",
  "stories",
  "default",
] as const;

const emailRecipients = ["submitter", "inquirer", "subscriber", "requester", "admins"] as const;
const postChannels = ["instagram", "facebook"] as const;

const options = (values: readonly string[], labels: Readonly<Record<string, string>>) =>
  values.map((value) => ({ value, label: labels[value] ?? value }));

const respectWindow = z.boolean().default(true);
const respectWindowField: StepField = {
  key: "respect_window",
  label: "Respect posting window",
  kind: "boolean",
  default: true,
};

export const stepSpecs: Record<StepType, StepSpec> = {
  send_email: {
    type: "send_email",
    label: "Send email",
    description: "Sends one email template to the person the event is about.",
    heavy: false,
    paramsSchema: z
      .object({
        template: z.string().min(1),
        attach: z.enum(["invoice_pdf"]).optional(),
        to: z.enum(emailRecipients).optional(),
      })
      .strict(),
    fields: [
      { key: "template", label: "Template", kind: "text", required: true },
      {
        key: "attach",
        label: "Attachment",
        kind: "select",
        options: [{ value: "invoice_pdf", label: "Invoice PDF" }],
      },
      {
        key: "to",
        label: "Recipient",
        kind: "select",
        options: options(emailRecipients, {
          submitter: "Submitter",
          inquirer: "Inquirer",
          subscriber: "Subscriber",
          requester: "Requester",
          admins: "Admins",
        }),
        hint: "Empty uses the recipient of the template.",
      },
    ],
    maxAttempts: providerMaxAttempts,
    sideEffect: "idempotency_key",
  },
  notify_admin: {
    type: "notify_admin",
    label: "Notify admins",
    description: "Sends a short notice to the admins.",
    heavy: false,
    paramsSchema: z
      .object({
        template: z.string().min(1).default("admin_notify"),
        headline: z.string().max(200).optional(),
      })
      .strict(),
    fields: [
      { key: "template", label: "Template", kind: "text", default: "admin_notify" },
      { key: "headline", label: "Headline", kind: "text", hint: "Variables are allowed." },
    ],
    maxAttempts: providerMaxAttempts,
    sideEffect: "idempotency_key",
  },
  bump_catalog_version: {
    type: "bump_catalog_version",
    label: "Refresh the catalog",
    description:
      "Raises the catalog version so cached pages renew, and opens a market on its first property.",
    heavy: false,
    paramsSchema: z.object({ flip_coming_soon: z.boolean().default(true) }).strict(),
    fields: [{ key: "flip_coming_soon", label: "Open the market", kind: "boolean", default: true }],
    sideEffect: "none",
  },
  purge_cache: {
    type: "purge_cache",
    label: "Purge cache",
    description: "Asks the edge cache to forget pages that changed.",
    heavy: false,
    paramsSchema: z
      .object({
        scope: z.enum(["catalog", "property", "all"]).default("catalog"),
        indexnow: z.boolean().default(false),
      })
      .strict(),
    fields: [
      {
        key: "scope",
        label: "Scope",
        kind: "select",
        options: [
          { value: "catalog", label: "Catalog" },
          { value: "property", label: "Property" },
          { value: "all", label: "Everything" },
        ],
        default: "catalog",
      },
      { key: "indexnow", label: "Ping search engines", kind: "boolean", default: false },
    ],
    sideEffect: "none",
  },
  render_variants: {
    type: "render_variants",
    label: "Render image sizes",
    description: "Renders the five sizes of every photograph: thumb, card, hero, og and carousel.",
    heavy: true,
    paramsSchema: z.object({}).strict(),
    fields: [],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  render_cover: {
    type: "render_cover",
    label: "Render cover",
    description: "Renders the cover image of the property.",
    heavy: true,
    paramsSchema: z.object({}).strict(),
    fields: [],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  render_carousel: {
    type: "render_carousel",
    label: "Render carousel",
    description: "Renders the carousel of the property.",
    heavy: true,
    paramsSchema: z.object({ max_slides: z.number().int().min(6).max(8).default(8) }).strict(),
    fields: [
      { key: "max_slides", label: "Most slides", kind: "number", default: 8, min: 6, max: 8 },
    ],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  render_story: {
    type: "render_story",
    label: "Render story",
    description: "Renders the vertical story frames of the property.",
    heavy: true,
    paramsSchema: z.object({}).strict(),
    fields: [],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  render_reel: {
    type: "render_reel",
    label: "Render reel",
    description: "Renders the 18 second reel of the property.",
    heavy: true,
    paramsSchema: z.object({}).strict(),
    fields: [],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  write_captions: {
    type: "write_captions",
    label: "Write captions",
    description:
      "Drafts captions and alt text. The editor's laptop runs it; captions can always be typed by hand.",
    heavy: false,
    local: true,
    paramsSchema: z.object({ alt_text: z.boolean().default(true) }).strict(),
    fields: [{ key: "alt_text", label: "Write alt text", kind: "boolean", default: true }],
    maxAttempts: providerMaxAttempts,
    sideEffect: "none",
  },
  build_newsletter_block: {
    type: "build_newsletter_block",
    label: "Build newsletter block",
    description: "Composes the property block for the next Place Notes issue.",
    heavy: false,
    paramsSchema: z.object({}).strict(),
    fields: [],
    sideEffect: "none",
  },
  post_meta: {
    type: "post_meta",
    label: "Post to Meta",
    description: "Posts the approved asset to Instagram, or to Facebook when its channel is on.",
    heavy: false,
    paramsSchema: z
      .object({
        channels: z
          .union([z.literal("from_settings"), z.array(z.enum(postChannels)).min(1)])
          .default("from_settings"),
        respect_window: respectWindow,
      })
      .strict(),
    fields: [
      {
        key: "channels",
        label: "Channels",
        kind: "multiselect",
        options: options(postChannels, { instagram: "Instagram", facebook: "Facebook" }),
        default: "from_settings",
        hint: "Empty uses the enabled channels in settings.",
      },
      respectWindowField,
    ],
    maxAttempts: providerMaxAttempts,
    sideEffect: "begin_row",
  },
  post_x: {
    type: "post_x",
    label: "Post to X",
    description: "Posts the approved asset to X.",
    heavy: false,
    paramsSchema: z.object({ respect_window: respectWindow }).strict(),
    fields: [respectWindowField],
    maxAttempts: providerMaxAttempts,
    sideEffect: "begin_row",
  },
  post_linkedin: {
    type: "post_linkedin",
    label: "Post to LinkedIn",
    description: "Posts the approved asset to LinkedIn.",
    heavy: false,
    paramsSchema: z.object({ respect_window: respectWindow }).strict(),
    fields: [respectWindowField],
    maxAttempts: providerMaxAttempts,
    sideEffect: "begin_row",
  },
  render_og_static: {
    type: "render_og_static",
    label: "Render static share images",
    description: "Renders the share images of the static pages. Run by hand, never by a recipe.",
    heavy: true,
    paramsSchema: z
      .object({
        pages: z
          .array(z.enum(ogStaticPages))
          .min(1)
          .default([...ogStaticPages]),
      })
      .strict(),
    fields: [
      {
        key: "pages",
        label: "Pages",
        kind: "multiselect",
        options: options(ogStaticPages, {}),
        default: ogStaticPages,
      },
    ],
    maxAttempts: providerMaxAttempts,
    sideEffect: "sql_guard",
  },
  queue_digest: {
    type: "queue_digest",
    label: "Queue digest",
    description: "Adds an approved block to the next issue, or builds the issue draft.",
    heavy: false,
    paramsSchema: z.object({ mode: z.enum(["add", "assemble"]).default("add") }).strict(),
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "add", label: "Add the block" },
          { value: "assemble", label: "Build the issue draft" },
        ],
        default: "add",
      },
    ],
    sideEffect: "none",
  },
  webhook_omnikom: {
    type: "webhook_omnikom",
    label: "Send to Omnikom",
    description: "Sends the inquiry to the Omnikom endpoint, with its attribution.",
    heavy: false,
    paramsSchema: z.object({}).strict(),
    fields: [],
    maxAttempts: providerMaxAttempts,
    sideEffect: "idempotency_key",
  },
};
