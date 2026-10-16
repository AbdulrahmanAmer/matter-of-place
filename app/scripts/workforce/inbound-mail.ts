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
  const notice = readNotice(sorted, message.attachments);
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
          reports: notice.reports,
        })
      : "";
  return {
    sorted,
    state: notice.state,
    args: {
      p_provider_id: message.providerId,
      p_folder: message.folder.name,
      p_from: message.from,
      p_name: message.fromName,
      p_alias: alias ?? "",
      p_subject: message.subject,
      p_body: plainText(message.content).slice(0, BODY_CAP),
      p_received_at: new Date(message.receivedAt).toISOString(),
      p_attachments: message.attachments.map((attachment) => attachment.name),
      p_source: sorted.source,
      p_state: notice.state,
      p_service: sorted.service ?? "",
      p_summary: notice.summary,
      p_report: reportJson(notice.reports),
      p_line: line,
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
  gate: "inside" | "not_owner" | "hold" | "answer",
): Promise<void> {
  if (triage?.source !== "email_inbound" || gate === "inside" || gate === "not_owner") return;
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
