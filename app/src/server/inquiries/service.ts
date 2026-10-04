import type { Inquiry, Receipt } from "../../domain/contracts";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PublicCtx } from "../public/routes";

const UNAVAILABLE = "We could not send this just now. Please try again in a moment.";

/** `POST /inquiries`: one row and its `inquiry.received` event through `create_inquiry` (G49, G20). */
export async function create(db: Db, input: Inquiry, ctx: PublicCtx): Promise<Receipt> {
  const { data, error } = await db.rpc("create_inquiry", {
    p: {
      intent: input.intent,
      topic: input.topic,
      subject_kind: input.subject?.kind,
      subject_slug: input.subject?.slug,
      subject_title: input.subject?.title,
      name: input.name,
      email: input.email,
      phone: input.phone,
      location: input.location,
      message: input.message,
      details: input.details,
      source_path: input.sourcePath,
      ip_hash: ctx.ipHash,
      turnstile_ok: ctx.turnstileOk,
      attribution: input.attribution,
    },
  });
  const row = data?.[0];
  if (error !== null || row === undefined)
    throw new AppError("unavailable", undefined, UNAVAILABLE);
  return { id: row.id, receivedAt: row.received_at };
}
