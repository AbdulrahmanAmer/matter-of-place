import { z } from "zod";
import { confirmQuerySchema, type Receipt, type subscriberSchema } from "../../domain/contracts";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { newToken, sha256Hex } from "../lib/ids";
import { requestConfirmation } from "./confirmation";

// `POST /subscribers` and `GET /subscribers/confirm` (double opt-in, G12, DL-06). Only the token's hash is
// stored; the raw token lives in this request's memory and, sealed, in the event that mails the link.

type Subscriber = z.infer<typeof subscriberSchema>;

/** `confirm_subscriber` answers the confirmed row's id, or null when no row holds the hash. */
const confirmedSchema = z.string().uuid().nullable();

const UNAVAILABLE = "We could not add you just now. Please try again in a moment.";

/** Where the confirm link lands, told whether the click confirmed an address. */
const landing = (confirmed: boolean): Response =>
  new Response(null, {
    status: 303,
    headers: {
      location: `/place-notes?confirmed=${confirmed ? "1" : "0"}`,
      "cache-control": "no-store",
    },
  });

/**
 * One `upsert_subscriber` call, which merges a known address by the rules of DL-06. The receipt is fresh every
 * time, whatever the address's state, so it never tells whether an address is on file.
 */
export async function subscribe(db: Db, input: Subscriber): Promise<Receipt> {
  const token = newToken();
  const { error } = await db.rpc("upsert_subscriber", {
    p: {
      email: input.email,
      markets: input.markets,
      source: input.source,
      confirm_token_hash: await sha256Hex(token),
      sealed_token: await requestConfirmation(token),
    },
  });
  if (error !== null) throw new AppError("unavailable", undefined, UNAVAILABLE);
  return { id: crypto.randomUUID(), receivedAt: new Date().toISOString() };
}

/** The confirm link: its token's hash confirms the one row holding it, and a used or unknown token confirms none. */
export async function confirm(db: Db, query: unknown): Promise<Response> {
  const parsed = confirmQuerySchema.safeParse(query);
  if (!parsed.success) return landing(false);
  const { data, error } = await db.rpc("confirm_subscriber", {
    p_token_hash: await sha256Hex(parsed.data.token),
  });
  if (error !== null) throw new AppError("unavailable", undefined, UNAVAILABLE);
  return landing(confirmedSchema.parse(data) !== null);
}
