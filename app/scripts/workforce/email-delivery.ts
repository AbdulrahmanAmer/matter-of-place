// W7 item 12 (the item's own text): "Email delivery for the Concierge: whether its approved replies were delivered,
// opened or bounced (item 1's data)." No row ties an approved reply to an email (approving `reply_inquiry` sends
// nothing, workforce_decide), so the Concierge is shown what became of the newest emails we sent about inquiries, each
// by the inquiry it answers: an email to the person of an inquiry is recorded there, a reply's included. The rows come from
// `concierge_email_delivery`, which reads `email_messages` and `email_events` and decides "opened" in the database, so
// no number of opens meets PostgREST's row cap; never an address or a subject line (a subject can carry a name).
import type { Db } from "../../src/server/lib/db.ts";

/** The colleague shown the block: it answers the people of inquiries. */
const READERS: readonly string[] = ["concierge"];
const NEWEST = 10;

const TEMPLATES: Record<string, string> = {
  inquiry_ack: "the acknowledgement",
};

const STATES: Record<string, string> = {
  queued: "waiting to be sent",
  sent: "sent, no delivery report yet",
  delivered: "delivered",
  bounced: "bounced",
  complained: "marked as spam by the reader",
  failed: "failed to send",
  skipped: "not sent, held back on purpose (a dry run or the do-not-send list)",
};

/** A row of `concierge_email_delivery`: one email about one inquiry. */
export interface DeliveryRow {
  inquiry_id: string;
  template_key: string;
  status: string;
  sent_at: string;
  opened: boolean;
}

function line(row: DeliveryRow): string {
  const state = STATES[row.status] ?? row.status;
  const opened = row.opened ? ", opened" : "";
  return `- ${row.sent_at.slice(0, 10)}, inquiry ${row.inquiry_id}, ${TEMPLATES[row.template_key] ?? row.template_key}: ${state}${opened}`;
}

/** The block: each email, newest first, with what became of it. */
export function deliveryBlock(rows: readonly DeliveryRow[]): string {
  return [
    `Email delivery (the ${String(NEWEST)} newest emails we sent about inquiries, newest first; "opened" only when the reader's mail reported it):`,
    ...(rows.length === 0 ? ["- none sent yet"] : rows.map(line)),
  ].join("\n");
}

/** The block for a Concierge run; nothing for anyone else. A failed read is one plain line. */
export async function emailDeliveryLines(client: Db, agentSlug: string): Promise<string[]> {
  if (!READERS.includes(agentSlug)) return [];
  try {
    const { data, error } = await client.rpc("concierge_email_delivery", { p_limit: NEWEST });
    if (error !== null) throw new Error("not read");
    return [deliveryBlock(data)];
  } catch {
    return ["The email delivery could not be read for this run; say so if a reply depends on it."];
  }
}
