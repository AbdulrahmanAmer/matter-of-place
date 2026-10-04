import type { Receipt, SubjectRequest } from "../../domain/contracts";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PublicCtx } from "../public/routes";

const UNAVAILABLE = "We could not take this request just now. Please try again in a moment.";

/**
 * `POST /subjects/request` (GP-01): one `subject_requests` row, due 45 days after it arrives. The receipt has the
 * same shape whether or not any data is on file for the address; matching happens when the team handles it.
 */
export async function request(db: Db, input: SubjectRequest, ctx: PublicCtx): Promise<Receipt> {
  const { data, error } = await db.rpc("create_subject_request", {
    p: {
      email: input.email,
      kind: input.kind,
      note: input.note,
      ip_hash: ctx.ipHash,
      turnstile_ok: ctx.turnstileOk,
    },
  });
  const row = data?.[0];
  if (error !== null || row === undefined)
    throw new AppError("unavailable", undefined, UNAVAILABLE);
  return { id: row.id, receivedAt: row.received_at };
}
