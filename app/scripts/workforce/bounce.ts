// W9 item 3 (operator, 2026-10-15: "we need to be able to see ... if an email is wrong or bounced"): a bounce reaches
// the team. `apply_email_event` emits `email.bounced` about the request or inquiry the email was for; it wakes the
// colleague who owns that source (the one who wakes when such a request or inquiry arrives: the Editor for listings,
// the Concierge for inquiries), and the run is told the failed address and the person's phone, read here on the
// runner because the event carries ids only.
import type { Db } from "../../src/server/lib/db.ts";

const ADMIN = "https://matterofplace.com/admin";

/** The arrival event of each source: its owner is the colleague woken by it. */
const ownerEvent: Readonly<Record<string, string>> = {
  submission: "submission.received",
  inquiry: "inquiry.received",
};

/** A phone as the form left it: null or blank (the Fairfield request holds "") reads "none given". */
const phoneOf = (phone: string | null): string =>
  phone === null || phone.trim() === "" ? "none given" : phone;

/** Whether an event wakes a colleague: on duty, the type in its `wake_on`, and for a bounce, the owner of its source. */
export function wakes(
  agent: { wake_on: readonly string[]; state: string },
  event: { type: string; entity: string | null },
): boolean {
  if (agent.state === "off" || agent.state === "paused" || !agent.wake_on.includes(event.type))
    return false;
  if (event.type !== "email.bounced") return true;
  const owner = event.entity === null ? undefined : ownerEvent[event.entity];
  return owner !== undefined && agent.wake_on.includes(owner);
}

/** The facts a woken owner needs about a bounce: what bounced, the failed address, the phone, the page to open. */
export async function bounceFacts(
  client: Db,
  event: { entity: string | null; entity_id: string | null; payload: unknown },
): Promise<string | null> {
  if (event.entity_id === null) return null;
  const payload = typeof event.payload === "object" && event.payload !== null ? event.payload : {};
  const reason =
    "reason" in payload && payload.reason === "complaint" ? "was marked as spam" : "bounced";
  const template =
    "template" in payload && typeof payload.template === "string" ? payload.template : "an email";
  const next =
    "Propose the next step in Approvals: a call to the person if there is a phone, or a way to ask for the right address. Matter decides; nothing more is sent to the failed address.";
  if (event.entity === "submission") {
    const { data } = await client
      .from("submissions")
      .select(
        "submitter_name, submitter_email, submitter_phone, address, city, state, workflow_state",
      )
      .eq("id", event.entity_id)
      .maybeSingle();
    if (data === null) return null;
    return [
      `The ${template} email about request ${event.entity_id} (${data.address}, ${data.city}, ${data.state}; ${data.workflow_state}) ${reason}.`,
      `The failed address: ${data.submitter_email}. ${data.submitter_name}'s phone: ${phoneOf(data.submitter_phone)}.`,
      `The request page: ${ADMIN}/requests/${event.entity_id}`,
      next,
    ].join("\n");
  }
  if (event.entity === "inquiry") {
    const { data } = await client
      .from("inquiries")
      .select("name, email, phone")
      .eq("id", event.entity_id)
      .maybeSingle();
    if (data === null) return null;
    return [
      `The ${template} email about inquiry ${event.entity_id} ${reason}.`,
      `The failed address: ${data.email}. ${data.name}'s phone: ${phoneOf(data.phone)}.`,
      `The inquiries page: ${ADMIN}/inquiries`,
      next,
    ].join("\n");
  }
  return null;
}
