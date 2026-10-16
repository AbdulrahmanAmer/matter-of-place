import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";

// W8 0h (operator, 2026-10-16: "the company and Matter should be able to see all emails"): every message the laptop
// runner recorded from the admin@ mailbox (`inbound_mail`), on the Sent emails screen. Its words come from outside the
// company: plain text for a person to read, never HTML and never a prompt.

/** The sources `inbound_mail.source` takes (migration 20261016143500_w8_0h_inbound_mail.sql). */
export const inboundSources = ["email_inbound", "service_notice", "our_mail"] as const;

/** The states `inbound_mail.state` takes. */
export const inboundStates = [
  "new",
  "routed",
  "held",
  "escalated",
  "recorded",
  "ignored",
  "spam",
  "capped",
] as const;

/** The triage of a person's message as the runner wrote it back: its labels only, never its words. */
const inboundTriageSchema = z.object({
  intent: z.string().max(80),
  instructions_to_ai: z.boolean(),
  gate: z.enum(["hold", "answer"]),
});

/** One recorded message, newest first on the screen. */
export const inboundMailSchema = z.object({
  id: z.string().uuid(),
  received_at: z.string(),
  folder: z.string(),
  from_email: z.string().nullable(),
  from_name: z.string().nullable(),
  /** The alias of admin@ it was sent to (`hello`, `press` ...); null for a Bcc. */
  alias: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  attachments: z.array(z.string()),
  source: z.enum(inboundSources),
  service: z.string().nullable(),
  /** The runner's fixed words about it: a report's counts, or why it was ignored. */
  summary: z.string(),
  triage: inboundTriageSchema.nullable(),
  /** The colleague it went to (`agents.slug`), Matter for a notice; null when no one was woken. */
  owner_slug: z.string().nullable(),
  state: z.enum(inboundStates),
});

export type InboundMail = z.infer<typeof inboundMailSchema>;

/** `GET /api/admin/emails/inbound`: one keyset page, newest first, optionally one source and one state (17c). */
export const inboundMailListInputSchema = adminPageSchema.extend({
  source: z.enum(inboundSources).optional(),
  state: z.enum(inboundStates).optional(),
});

export const inboundMailListSchema = adminPageAnswer(inboundMailSchema);

/** The triage a row holds, or null when it holds none or one the screen cannot read (it never fails a page). */
export function inboundTriage(value: unknown): z.infer<typeof inboundTriageSchema> | null {
  const parsed = inboundTriageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
