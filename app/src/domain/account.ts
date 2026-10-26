import { z } from "zod";
import {
  exposurePackages,
  submissionMediaSchema,
  submissionStates,
  type SubmissionState,
} from "./contracts.ts";
import { paymentStatuses } from "./payments.ts";

// W6 item 7, ruling H119: the client room. Field names are those `account_room` returns.

/**
 * Where a request stands, in a sentence for the client (W6 item 7 review): the pipeline's own state names are staff
 * labels. One sentence per state, so a new state cannot reach the room without words. Item 8's timeline reuses these.
 */
export const requestStatusLines: Record<SubmissionState, string> = {
  Submitted: "We have your request and will read it soon.",
  "Under Review": "We are reading your request.",
  Accepted: "We accepted your request. What comes next will reach you by email.",
  Declined: "We are not able to take this one on.",
  "Awaiting Assets": "We are waiting for the photographs and details we asked you for.",
  "Invoice Issued": "Your invoice has been sent. Please look for it in your email.",
  Scheduled: "Your property is scheduled to go live on the site.",
  Published: "Your property is live on the site.",
  "Distribution Active": "Your property is live, and we are sharing it with our readers.",
  Completed: "This request is complete.",
  Withdrawn: "This request was withdrawn.",
};

/** One of the client's own requests, by address and state. */
const accountRequestSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  workflow_state: z.enum(submissionStates),
  received_at: z.string(),
});

export const accountRoomSchema = z.object({
  name: z.string(),
  email: z.string(),
  requests: z.array(accountRequestSchema),
});

/**
 * The client room's pages: never stored by the edge and never given a third-party script, since the address of the
 * confirm page carries a sign-in token (ruling H119). `path` is decoded and lower case, as the router matches it.
 */
export const isAccountPath = (path: string): boolean =>
  path === "/account" || path.startsWith("/account/");

export type AccountRequest = z.infer<typeof accountRequestSchema>;

/** What `/account` shows: the sign-in form, the calm "not found" page, or the room. */
export type AccountView = AccountPage<z.infer<typeof accountRoomSchema>>;

/** The sign-in form: an address and the Turnstile token of the `account-send-link` action. */
export const accountLinkInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  turnstile: z.string().max(4096).nullable(),
});

/** The confirm page's post: the token hash the email link carried. */
export const accountConfirmInput = z.object({
  token_hash: z.string().min(1).max(512),
});

/** What the confirm page's post found: a session, a spent or old token, or a person who signs in at `/admin`. */
export type AccountConfirmStatus = "signed-in" | "expired" | "staff";

// W6 item 8, rulings H119 and H142: the pages of the room. Field names are those the `account_*` functions return; each
// answer names the person it is for (name, email), so every page can say whose room it is.

/** The one name and address every page of the room carries. */
const accountPerson = { name: z.string(), email: z.string() };

/** What a page of the room shows: the sign-in form, the calm "not found" page, or its own data. */
export type AccountPage<T extends { name: string; email: string }> =
  { state: "signed-out" } | { state: "unknown" } | ({ state: "room" } & T);

/** One of the client's own requests, with the dates its timeline needs and the live page once there is one. */
const accountPropertySchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  package: z.enum(exposurePackages),
  workflow_state: z.enum(submissionStates),
  received_at: z.string(),
  reviewed_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  activated_at: z.string().nullable(),
  published_at: z.string().nullable(),
  live_path: z.string().nullable(),
  photos: z.number().int(),
  can_add_photos: z.boolean(),
});

export const accountPropertiesSchema = z.object({
  ...accountPerson,
  properties: z.array(accountPropertySchema),
});
export type AccountProperty = z.infer<typeof accountPropertySchema>;

/** An invoice or a waiver of the client's. `pay_url` is the Stripe link, null until the Stripe adapter exists. */
const accountInvoiceSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  product: z.enum(exposurePackages),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(paymentStatuses),
  invoice_number: z.string().nullable(),
  issued_at: z.string().nullable(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  credit: z.boolean(),
  // STUB(post-v1): the real Stripe adapter (server/payments/adapters/stripe.ts) returns the hosted payment link of a due invoice.
  pay_url: z.string().nullable().default(null),
});

export const accountInvoicesSchema = z.object({
  ...accountPerson,
  invoices: z.array(accountInvoiceSchema),
});
export type AccountInvoice = z.infer<typeof accountInvoiceSchema>;

/** A line of the ledger: a pack bought (positive) or a credit used for a request (negative). */
const accountCreditEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["purchased", "used"]),
  quantity: z.number().int(),
  created_at: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
});

export const accountCreditsSchema = z.object({
  ...accountPerson,
  balance: z.number().int(),
  purchased: z.number().int(),
  used: z.number().int(),
  entries: z.array(accountCreditEntrySchema),
});
export type AccountCreditEntry = z.infer<typeof accountCreditEntrySchema>;

/** One week of a campaign, as the weekly report email states it. */
const accountReportWeekSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  impressions: z.number(),
  reach: z.number(),
  clicks: z.number(),
  video_views: z.number().nullable(),
  ctr: z.number().nullable(),
});

/** Results for one property: the weekly figures and counts, never an inquirer's name, address or message. */
const accountReportSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  city: z.string(),
  live_path: z.string().nullable(),
  package: z.enum(exposurePackages).nullable(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
  page_views: z.number().int(),
  inquiries: z.number().int(),
  inquiries_30d: z.number().int(),
  weeks: z.array(accountReportWeekSchema),
});

export const accountReportsSchema = z.object({
  ...accountPerson,
  properties: z.array(accountReportSchema),
});
export type AccountReport = z.infer<typeof accountReportSchema>;

/** The pages of the room, in the order the nav lists them. */
export const accountPages = [
  { path: "/account/properties", label: "My properties" },
  { path: "/account/invoices", label: "Invoices" },
  { path: "/account/credits", label: "Credits" },
  { path: "/account/reports", label: "Reports" },
] as const;

/** The steps of a request's timeline, in the client's words, from the request to a finished campaign. */
export const timelineLabels = [
  "Received",
  "Under review",
  "Accepted",
  "Invoice",
  "Live on the site",
  "Complete",
] as const;

/** The last timeline step a state has reached. A declined or withdrawn request stops where it ended. */
const reached: Record<SubmissionState, number> = {
  Submitted: 0,
  "Under Review": 1,
  Accepted: 2,
  "Awaiting Assets": 2,
  "Invoice Issued": 3,
  Scheduled: 3,
  Published: 4,
  "Distribution Active": 4,
  Completed: 5,
  Declined: 1,
  Withdrawn: 0,
};

export interface TimelineStep {
  label: string;
  /** `current` is the last step reached; `ended` closes a request that will go no further. */
  status: "done" | "current" | "upcoming" | "ended";
  /** When the step was reached, where the record keeps it. */
  at: string | null;
}

/**
 * A request as a timeline (W6 item 8): the steps it has passed, the one it is at and those still to come, with the day
 * each was reached where the record holds it. A declined or withdrawn request shows the steps it passed and then says so.
 */
export function requestTimeline(
  property: Pick<
    AccountProperty,
    "workflow_state" | "received_at" | "reviewed_at" | "accepted_at" | "published_at"
  >,
): TimelineStep[] {
  const state = property.workflow_state;
  const last = reached[state];
  const ended = state === "Declined" || state === "Withdrawn";
  // Nothing is in progress once a request has ended or completed: its last step is passed, not current.
  const finished = ended || state === "Completed";
  const dates = [
    property.received_at,
    property.reviewed_at,
    property.accepted_at,
    null,
    property.published_at,
    null,
  ];
  const steps: TimelineStep[] = timelineLabels
    .slice(0, ended ? last + 1 : undefined)
    .map((label, index) => ({
      label,
      status:
        index < last || (index === last && finished)
          ? "done"
          : index === last
            ? "current"
            : "upcoming",
      at: index <= last ? (dates[index] ?? null) : null,
    }));
  if (ended) {
    steps.push({
      label: state === "Declined" ? "Not taken on" : "Withdrawn",
      status: "ended",
      at: null,
    });
  }
  return steps;
}

/**
 * Photographs added to one of the client's open requests (W6 item 8, phase 2): declared like the submit form declares
 * them, one to ten at a time so one call signs them all.
 */
export const accountPhotosInput = z.object({
  submission_id: z.string().uuid(),
  media: z.array(submissionMediaSchema).min(1).max(10),
});

/** The signed URLs for the photographs just declared, matched to the posted list by `index`. */
export interface AccountPhotosAnswer {
  uploads: { media_id: string; index: number; url: string; thumb_url: string }[];
}
