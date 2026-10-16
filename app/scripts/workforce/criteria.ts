// W8 0a (operator, 2026-10-15: "each source of something gets a criteria for what will be done for it ... this needs to
// be mechanical so it doesn't get skipped"). Every outside source that can wake a colleague is listed here with the
// intents it may carry, the colleague who owns it, the only proposals that colleague may make for it, and where its
// outside text lives. A source not in this file wakes no one with outside text. CRITICAL (security): changes here are
// built and reviewed at high effort.

/** An outside source: something a person outside the company wrote that can wake a colleague. */
export type Source = {
  /** Plain words for the triage and the logs. */
  label: string;
  /** What the triage may say the person wants; anything else is `out_of_criteria`. */
  intents: readonly string[];
  /** The colleague who answers, when the message is within the criteria. */
  owner: string;
  /** The only proposals the owner may make for a message of this source (W8 0c); every other one is dropped. */
  actions: readonly string[];
};

export const sources = {
  inquiry: {
    label: "an inquiry sent from a property or market page",
    intents: ["property_question", "showing_request", "correction"],
    owner: "concierge",
    actions: ["reply_inquiry"],
  },
  email_reply: {
    label: "an email reply to a message we sent",
    intents: ["answer_to_our_email", "question_about_our_email", "unsubscribe"],
    owner: "concierge",
    actions: ["reply_inquiry"],
  },
  submission: {
    label: "a property submitted for review",
    intents: ["submit_property"],
    owner: "editor",
    actions: [],
  },
  privacy_request: {
    label: "a privacy request (access, deletion, opt-out)",
    intents: ["privacy_request"],
    owner: "concierge",
    actions: [],
  },
  // W8 0h: a person writing to one of our addresses who is not replying to our mail (a new client, a press request, a
  // privacy request by mail). Its owner is chosen by the alias (`inbound_mail_record`: the Editor for listings@, else
  // the Concierge); press and anything else outside these intents is held for Matter (W8 0d).
  email_inbound: {
    label: "an email a person sent to one of our addresses",
    intents: ["property_question", "showing_request", "list_a_property", "privacy_request", "correction"],
    owner: "concierge",
    actions: ["reply_inquiry"],
  },
  // W8 0h: mail from a known service (Google, Cloudflare, Sentry ...) that authenticated as it. It never wakes a
  // colleague and is never triaged: the runner decides its intent from the message's own reports (a clean report is
  // only recorded) and writes the rest as a notice in fixed words in Matter's thread (service-notice.ts).
  service_notice: {
    label: "a notice from a service we use",
    intents: ["clean_report", "failing_report", "service_alert"],
    owner: "matter",
    actions: [],
  },
} as const satisfies Record<string, Source>;

export type SourceName = keyof typeof sources;

/** The event that brings each source's outside text to the runner; an event not listed carries none. */
const sourceOfEvent: Partial<Record<string, SourceName>> = {
  "inquiry.received": "inquiry",
  "submission.received": "submission",
  "subject_request.received": "privacy_request",
  // W8 0h: a person's email, recorded by `inbound_mail_record`; the event names the row, its text stays there.
  "email.received": "email_inbound",
};

/** The outside source an event is, or null when the event carries no outside text (an inside event). */
export function sourceOf(eventType: string): SourceName | null {
  return sourceOfEvent[eventType] ?? null;
}

/** W8 0c: whether the owner of a source may make this proposal for one of its messages. */
export function allowedFor(source: SourceName, action: string): boolean {
  return (sources[source].actions as readonly string[]).includes(action);
}
