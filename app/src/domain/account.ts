import { z } from "zod";
import { submissionStates } from "./contracts.ts";

// W6 item 7, ruling H114: the client room. Field names are those `account_room` returns.

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
  requests: z.array(accountRequestSchema),
});

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
