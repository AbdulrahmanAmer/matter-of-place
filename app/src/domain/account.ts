import { z } from "zod";
import { submissionStates, type SubmissionState } from "./contracts.ts";

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
export type AccountView =
  | { state: "signed-out" }
  | { state: "unknown" }
  | ({ state: "room" } & z.infer<typeof accountRoomSchema>);

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
