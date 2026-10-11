import { t } from "../../../lib/strings";
import type { ServiceIssue } from "../../../services";
import type { StepIndex, SubmitDraft } from "./state";

/**
 * Where every field the contract (`submissionSchema`) names sits in the wizard: its step and the name it goes by
 * in a list of problems. `currency` and `sourcePath` are not the visitor's to fix and have no entry; a refusal that
 * names them is not placed (`fieldIssues`). `tests/unit/submit-issues.test.ts` fails when the contract gains a
 * field this table does not know.
 */
export const fieldHome = {
  address: { step: 0, label: "Property address" },
  city: { step: 0, label: "City" },
  state: { step: 0, label: "State" },
  zip: { step: 0, label: "ZIP" },
  propertyType: { step: 0, label: "Property type" },
  price: { step: 0, label: "Asking price (USD)" },
  beds: { step: 0, label: "Bedrooms" },
  baths: { step: 0, label: "Bathrooms" },
  interiorSqFt: { step: 0, label: "Approximate square feet" },
  listingUrl: { step: 0, label: "Listing URL" },
  architect: { step: 1, label: "Architect" },
  designer: { step: 1, label: "Designer" },
  yearBuilt: { step: 1, label: "Year built" },
  yearRenovated: { step: 1, label: "Year renovated" },
  story: { step: 1, label: "The property story" },
  significance: { step: 1, label: "What makes this property significant?" },
  photographyUrl: { step: 1, label: "Photography link" },
  videoUrl: { step: 1, label: "Video link" },
  media: { step: 1, label: "Photography" },
  submitterKind: { step: 2, label: "I am" },
  submitterName: { step: 2, label: "Your name" },
  brokerage: { step: 2, label: "Brokerage" },
  submitterEmail: { step: 2, label: "Email" },
  submitterPhone: { step: 2, label: "Phone" },
  sourceUrl: { step: 2, label: "MLS or source link" },
  listedWithAgent: { step: 2, label: "Listed with an agent" },
  listingAgentName: { step: 2, label: "Listing agent name" },
  listingAgentBrokerage: { step: 2, label: "Listing agent brokerage" },
  package: { step: 3, label: "Preferred exposure" },
  mediaBudget: { step: 3, label: "Media budget" },
  rightsConfirmed: { step: 3, label: "Rights to the photography" },
} as const satisfies Record<string, { step: StepIndex; label: string }>;

export type SubmitField = keyof typeof fieldHome;

const order = Object.keys(fieldHome);

const isField = (key: unknown): key is SubmitField =>
  typeof key === "string" && Object.hasOwn(fieldHome, key);

/** The field a draft entry belongs to: the same name, except that the photographs are the contract's `media`. */
export const fieldOf = (key: keyof SubmitDraft): SubmitField => (key === "files" ? "media" : key);

/** One refused field, placed: its step (0 to 3), its name in a list and the sentence for the visitor. */
export type FieldIssue = {
  field: SubmitField;
  step: StepIndex;
  label: string;
  message: string;
};

/** What to say when the field is filled but not acceptable; a field without a line here gets the general one. */
const notAccepted: Partial<Record<SubmitField, string>> = {
  state: t.forms.issue.choose,
  propertyType: t.forms.issue.choose,
  submitterKind: t.forms.issue.choose,
  package: t.forms.issue.choose,
  zip: t.forms.issue.zip,
  listingUrl: t.forms.issue.link,
  photographyUrl: t.forms.issue.link,
  videoUrl: t.forms.issue.link,
  sourceUrl: t.forms.issue.link,
  submitterEmail: t.forms.issue.email,
  price: t.forms.issue.price,
  beds: t.forms.issue.beds,
  baths: t.forms.issue.zeroOrMore,
  mediaBudget: t.forms.issue.zeroOrMore,
  interiorSqFt: t.forms.issue.squareFeet,
  yearBuilt: t.forms.issue.year,
  yearRenovated: t.forms.issue.year,
  rightsConfirmed: t.forms.issue.rights,
  media: t.forms.issue.photographs,
};

/** Fields whose "missing" is a choice, not typing: they answer with their own line, never "fill in". */
const chosen: readonly SubmitField[] = ["state", "propertyType", "submitterKind", "package"];

const isMissing = (issue: ServiceIssue) =>
  (issue.code === "too_small" && issue.type === "string") ||
  (issue.code === "invalid_type" && issue.received === "undefined");

function sentence(field: SubmitField, issue: ServiceIssue): string {
  // The contract's own rules ("Name your brokerage") are written for the visitor.
  if (issue.code === "custom") return issue.message;
  if (isMissing(issue) && !chosen.includes(field)) return t.forms.fieldRequired;
  if (issue.code === "too_big" && issue.type === "string") return t.forms.issue.tooLong;
  return notAccepted[field] ?? t.forms.fieldInvalid;
}

/**
 * The refusals that name a field of the wizard, one per field (the first), in the order of the steps. A path the
 * wizard does not know (`sourcePath`, a prototype key, a path-less issue) is left out, so what remains can all be
 * shown on its step.
 */
export function fieldIssues(raw: readonly ServiceIssue[]): FieldIssue[] {
  const found = new Map<SubmitField, FieldIssue>();
  for (const issue of raw) {
    const field = issue.path[0];
    if (!isField(field) || found.has(field)) continue;
    const { step, label } = fieldHome[field];
    found.set(field, { field, step, label, message: sentence(field, issue) });
  }
  return [...found.values()].sort(
    (a, b) => a.step - b.step || order.indexOf(a.field) - order.indexOf(b.field),
  );
}

/** The step to go back to: the first one with a refused field. */
export const firstIssueStep = (issues: readonly FieldIssue[]): StepIndex | undefined =>
  issues[0]?.step;

/** One line of the list on the Review step. Steps are numbered from 1, as the progress bar shows them. */
export const issueLine = (issue: FieldIssue): string =>
  t.forms.issueLine(issue.label, issue.step + 1, issue.message);

/** What a step passes to a control and its wrapper; the same shape as `useFieldErrors`. */
export type Problems = {
  field: (name: SubmitField) => { error: string | undefined; errorId: string };
  control: (name: SubmitField) => { "aria-invalid"?: true; "aria-describedby"?: string };
};

/** The marks for the refused fields: `aria-invalid` on the control, pointing at the visible message. */
export function problemsOf(issues: readonly FieldIssue[], prefix: string): Problems {
  const errorId = (name: SubmitField) => `${prefix}-${name}-error`;
  const messageOf = (name: SubmitField) => issues.find((issue) => issue.field === name)?.message;
  return {
    field: (name) => ({ error: messageOf(name), errorId: errorId(name) }),
    control: (name) =>
      messageOf(name) === undefined
        ? {}
        : { "aria-invalid": true, "aria-describedby": errorId(name) },
  };
}
