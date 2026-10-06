import { z } from "zod";
import type { Json } from "../../db/index.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";

// What a verified Resend event does after `hooks/resend.ts` has recorded its receipt (invariant 9). The database
// function `apply_email_event` does the writes (G43); this file only maps the event to its argument.

/** The fields of a Resend webhook event that are read; everything else passes through unread. */
export const resendEvent = z
  .object({
    type: z.string(),
    created_at: z.string().optional(),
    data: z
      .object({
        email_id: z.string().optional(),
        broadcast_id: z.string().optional(),
        audience_id: z.string().optional(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
        email: z.string().optional(),
        unsubscribed: z.boolean().optional(),
        tags: z.record(z.string(), z.unknown()).optional(),
        bounce: z.object({ type: z.string().optional() }).passthrough().optional(),
        click: z.object({ link: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ResendEvent = z.infer<typeof resendEvent>;

const recipient = ({ type, data }: ResendEvent): string | undefined =>
  type === "contact.updated" ? data.email : [data.to].flat()[0];

/**
 * Applies one verified event. `id` is the `svix-id`, the key a replay is recognised by. An `email.*` event tagged for
 * another stage is dropped before any call: a late event of mail sent in `preview` must not touch production (INT-02).
 * An event without an `env` tag (a Broadcast, which the audience filter of the function judges) goes through. An RPC
 * error is thrown so that the handler forgets the receipt and Resend's retry applies the event again.
 */
export async function applyEmailEvent(
  db: Db,
  event: ResendEvent & { id: string },
  ownEnv: string,
): Promise<void> {
  const { id, type, data } = event;
  const taggedEnv = data.tags?.["env"];
  if (type.startsWith("email.") && typeof taggedEnv === "string" && taggedEnv !== ownEnv) {
    logLine("info", "email_event_foreign_env", { type });
    return;
  }
  const p: Json = {
    provider_event_id: id,
    type,
    resend_email_id: data.email_id,
    broadcast_id: data.broadcast_id,
    audience_id: data.audience_id,
    to_email: recipient(event),
    at: event.created_at,
    data: {
      bounce_type: data.bounce?.type,
      unsubscribed: data.unsubscribed,
      link: data.click?.link,
    },
  };
  const { error } = await db.rpc("apply_email_event", { p });
  if (error !== null) throw new AppError("server", undefined, "The event could not be applied.");
}
