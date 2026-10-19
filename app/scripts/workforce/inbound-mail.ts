// W8 0h (operator, 2026-10-16): one message of the admin@ mailbox that is not a reply to our own email, from the
// parts the Zoho API gives (`mail.ts` fetches them) to the one recording call, `inbound_mail_record`. The SQL wakes a
// person's message's owner through the event `email.received` (the runner triages it with no tools, W8 0b) and puts a
// service notice in Matter's thread as the runner's fixed line. Nothing here logs or prints a sender, a subject or a
// body. CRITICAL (outside text).
import type { Json } from "../../src/db/index.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { plainText } from "./mail.ts";
import type { Report, Unparsed } from "./mail-reports.ts";
import {
  aliasOf,
  noticeLine,
  readNotice,
  sortMessage,
  type Attachment,
  type InboundState,
  type Sorted,
} from "./service-notice.ts";
import type { Triage } from "./triage.ts";

/** The text kept of a message, as `email_replies.body` keeps a reply's. */
export const BODY_CAP = 6000;

/** The parts of a message the pass could not read (W8 0h review), named in the row's summary in these words only. */
export type UnreadPart = "the header" | "the text" | "the attachment list" | "the message";

export type InboundMessage = {
  providerId: string;
  folder: { name: string; type: string };
  from: string;
  fromName: string;
  subject: string;
  receivedAt: number;
  header: string;
  /** The message's HTML or text as Zoho gives it. */
  content: string;
  attachments: readonly Attachment[];
  automatic: boolean;
  /** What could not be read; the message is recorded with the rest and still reaches its owner. */
  unread?: readonly UnreadPart[];
};

export type Recorded = {
  sorted: Sorted;
  state: InboundState;
  args: {
    p_provider_id: string;
    p_folder: string;
    p_from: string;
    p_name: string;
    p_alias: string;
    p_subject: string;
    p_body: string;
    p_received_at: string;
    p_attachments: string[];
    p_source: string;
    p_state: string;
    p_service: string;
    p_summary: string;
    p_report: Json;
    p_line: string;
  };
};

/**
 * W8 0h fourth review: Postgres text refuses U+0000 and its JSON refuses an unpaired surrogate, and a decoded subject,
 * a sender's name or a report's field can carry either; one such character must never stop a folder. Every text the
 * mailbox sends to a recording call passes through this.
 */
export function storable(text: string): string {
  return text
    .replaceAll("\u0000", "")
    .replaceAll(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** `storable` on every string of a report's JSON, keys included. */
function storableJson(value: Json | undefined): Json {
  if (value === undefined) return null;
  if (typeof value === "string") return storable(value);
  if (Array.isArray(value)) return value.map((item) => storableJson(item));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [storable(key), storableJson(item)]),
    );
  return value;
}

/** The JSON a report is kept as: counts and checked names only (mail-reports.ts). */
function reportJson(reports: readonly (Report | Unparsed)[]): Json {
  if (reports.length === 0) return null;
  return reports.map((report): Json => {
    if (report.kind === "unparsed") return { kind: report.kind, reason: report.reason };
    if (report.kind === "tls")
      return {
        kind: report.kind,
        org: report.org,
        domains: report.domains,
        successful: report.successful,
        failed: report.failed,
        failures: report.failures.slice(0, 50),
      };
    const { sources, ...counts } = report;
    return { ...counts, sources: sources.slice(0, 50) };
  });
}

/** What one message is and the arguments that record it (pure: tested on the replayed real messages). */
export function inboundRecord(message: InboundMessage): Recorded {
  const sorted = sortMessage({
    folderType: message.folder.type,
    folderName: message.folder.name,
    from: message.from,
    subject: message.subject,
    header: message.header,
    automatic: message.automatic,
  });
  const notice = readNotice(sorted, {
    attachments: message.attachments,
    folderName: message.folder.name,
    header: message.header,
    from: message.from,
    content: message.content,
  });
  const alias = aliasOf(message.header);
  const line =
    notice.state === "escalated"
      ? noticeLine({
          service: sorted.service ?? "a service",
          folder: message.folder.name,
          alias,
          from: message.from,
          subject: message.subject,
          summary: notice.summary,
          detail: notice.detail,
          reports: notice.reports,
        })
      : "";
  return {
    sorted,
    state: notice.state,
    args: {
      p_provider_id: storable(message.providerId),
      p_folder: storable(message.folder.name),
      p_from: storable(message.from),
      p_name: storable(message.fromName),
      p_alias: alias ?? "",
      p_subject: storable(message.subject),
      // W8 0h review: a service's or our own mail keeps its subject and labels, never its body (login and verification
      // codes of the accounts on admin@ arrive that way); a person's email keeps its words for the person who answers.
      p_body:
        sorted.source === "email_inbound"
          ? storable(plainText(message.content)).slice(0, BODY_CAP)
          : "",
      p_received_at: new Date(message.receivedAt).toISOString(),
      p_attachments: message.attachments.map((attachment) => storable(attachment.name)),
      p_source: sorted.source,
      p_state: notice.state,
      p_service: storable(sorted.service ?? ""),
      p_summary: storable(
        (message.unread ?? []).length === 0
          ? notice.summary
          : `${notice.summary.replace(/\.?$/, ".")} Not read: ${(message.unread ?? []).join(", ")}; a person reads it in the mailbox.`,
      ),
      p_report: storableJson(reportJson(notice.reports)),
      p_line: storable(line),
    },
  };
}

/** Records one message; true when it is new, false when either table already held its id. A failure throws. */
export async function recordInbound(client: Db, recorded: Recorded): Promise<boolean> {
  const { data, error } = await client.rpc("inbound_mail_record", recorded.args);
  if (error !== null) throw new Error("mail: an inbound message could not be recorded");
  // The function returns null for a message already recorded; the generated type cannot say so.
  return (data as string | null) !== null;
}

/**
 * W8 0h: the triage of a person's email, written back to its row when its owner's run sorted it, so a person sees in
 * the admin whether it was answered or held. Only the triage's labels are kept (intent, whether it tried to direct the
 * AI, the gate), never its described words. A row that cannot be updated is said in the log, never a failed run.
 */
export async function noteTriage(
  client: Db,
  triage: Triage | null,
  gate: "inside" | "not_owner" | "hold" | "answer" | "explain",
): Promise<void> {
  // An explanation (W8 0d) is the owner's run on a line already held: the row already says held.
  if (
    triage?.source !== "email_inbound" ||
    gate === "inside" ||
    gate === "not_owner" ||
    gate === "explain"
  )
    return;
  const id = /^email_inbound ([0-9a-f-]{36})$/.exec(triage.about)?.[1];
  if (id === undefined) return;
  const { error } = await client
    .from("inbound_mail")
    .update({
      triage: { intent: triage.intent, instructions_to_ai: triage.instructions_to_ai, gate },
      state: gate === "hold" ? "held" : "routed",
    })
    .eq("id", id)
    .eq("source", "email_inbound");
  if (error !== null) console.log("mail: the triage of an inbound message was not written back");
}

/**
 * W8 0h review (H121 (1)): a person offering a property is the Editor's, whatever address they wrote to. The SQL chose
 * the owner by alias; when another colleague's triage says `list_a_property` and the message may be answered, the run
 * is handed to the Editor on the same event (the Editor's own run triages it again) and the row names the Editor. True
 * when it was handed, so this run ends; false when it is the Editor's already, the Editor is off, or anything failed.
 */
export async function handToEditor(
  client: Db,
  triage: Triage | null,
  gate: "inside" | "not_owner" | "hold" | "answer" | "explain",
  agentSlug: string,
  eventId: string | null,
): Promise<boolean> {
  if (triage?.source !== "email_inbound" || triage.intent !== "list_a_property") return false;
  if (gate !== "answer" || agentSlug === "editor" || eventId === null) return false;
  const id = /^email_inbound ([0-9a-f-]{36})$/.exec(triage.about)?.[1];
  if (id === undefined) return false;
  const { data: editor } = await client
    .from("agents")
    .select("id")
    .eq("slug", "editor")
    .neq("state", "off")
    .limit(1);
  const editorId = editor?.[0]?.id;
  if (editorId === undefined) return false;
  // A run already queued for the Editor on this event counts 0 and is handed all the same (fourth review).
  const { error } = await client.rpc("queue_event_runs", {
    p_agents: [editorId],
    p_events: [eventId],
  });
  if (error !== null) return false;
  const { error: named } = await client
    .from("inbound_mail")
    .update({ owner_slug: "editor" })
    .eq("id", id)
    .eq("source", "email_inbound");
  if (named !== null) console.log("mail: the new owner of an inbound message was not written back");
  return true;
}
