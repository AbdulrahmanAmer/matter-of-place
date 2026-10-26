import type { RecipeRow, StepSpecView } from "./automation-queries";

// W3 (operator, 2026-10-12: "it is just for renders, not easy to use"): a flow read as a sentence. Each event gets the
// words a person says ("a property is published") and the topic it is listed under, so the screen never shows
// `property.published` to read. An event added later without words here still reads, from its recipe name.

interface EventWords {
  /** Finishes "When ..." */
  when: string;
  topic: FlowTopic;
}

export const flowTopics = ["Requests", "Listings", "Readers", "Money", "Care"] as const;
export type FlowTopic = (typeof flowTopics)[number];

const words: Record<string, EventWords> = {
  "submission.received": { when: "a property request arrives", topic: "Requests" },
  "submission.awaiting_assets": {
    when: "a request is waiting for photographs",
    topic: "Requests",
  },
  "submission.accepted": { when: "a request is accepted", topic: "Requests" },
  "submission.declined": { when: "a request is declined", topic: "Requests" },
  "submission.activated": { when: "an accepted request becomes a listing", topic: "Requests" },
  "property.published": { when: "a property is published", topic: "Listings" },
  "property.unpublished": { when: "a property is taken down", topic: "Listings" },
  "asset.approved": { when: "a visual is approved", topic: "Listings" },
  "asset.rejected": { when: "a visual is turned down", topic: "Listings" },
  "inquiry.received": { when: "a buyer or agent sends an inquiry", topic: "Readers" },
  "subscriber.created": { when: "someone signs up for Place Notes", topic: "Readers" },
  "subscriber.confirmed": { when: "a sign-up is confirmed", topic: "Readers" },
  "digest.due": { when: "Place Notes is due", topic: "Readers" },
  "invoice.issued": { when: "an invoice is sent", topic: "Money" },
  "invoice.voided": { when: "an invoice is cancelled", topic: "Money" },
  "payment.marked": { when: "a payment is recorded", topic: "Money" },
  "subject_request.received": { when: "someone asks about their personal data", topic: "Care" },
  "health.failed": { when: "the daily health check fails", topic: "Care" },
  "email.bounced": { when: "an email to a request or an inquiry bounces", topic: "Care" },
  "email.received": { when: "a person emails one of our addresses", topic: "Readers" },
  "email.reply_received": { when: "a person replies to an email we sent", topic: "Readers" },
};

/** "a property is published", or the recipe's own name in lower case when the event is new. */
export function whenOf(recipe: Pick<RecipeRow, "trigger" | "name">): string {
  return words[recipe.trigger]?.when ?? recipe.name.toLowerCase();
}

export function topicOf(trigger: string): FlowTopic {
  return words[trigger]?.topic ?? "Care";
}

/** The step names of the steps that are on, joined as a person would say them. */
export function thenOf(
  steps: RecipeRow["steps"],
  specs: readonly StepSpecView[],
  most = Infinity,
): string {
  const names = steps
    .filter((step) => step.enabled)
    .map((step) => specs.find((spec) => spec.type === step.step_type)?.label ?? step.step_type);
  if (names.length === 0) return "nothing happens";
  const shown = names.slice(0, most);
  const rest = names.length - shown.length;
  const list = rest > 0 ? [...shown, `${String(rest)} more`] : shown;
  if (list.length === 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1) ?? ""}`;
}
