import { z } from "zod";
import {
  inboundMailListSchema,
  inboundMailSchema,
  inboundTriage,
  type inboundMailListInputSchema,
} from "../../../domain/admin-inbound-mail.ts";
import { fromRpcError } from "../../lib/admin-errors.ts";
import type { AdminActor } from "../../lib/admin-route.ts";
import { authorize } from "../../lib/authz.ts";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";

// W8 0h: every message the laptop runner recorded from the mailbox (`inbound_mail`), newest first, with the Sent emails
// screen's right. The words come from outside the company: they go to a person's screen and to nothing else.

const COLUMNS =
  "id, received_at, folder, from_email, from_name, alias, subject, body, attachments, source, service, summary, triage, owner_slug, state";
/** A page starts after the row it names: its `received_at` exactly as listed, then its id. */
const AFTER = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

const row = inboundMailSchema.extend({ triage: z.unknown() });
type Input = z.output<typeof inboundMailListInputSchema>;
type Row = z.infer<typeof row>;

/** The rows of one filter, newest first: before the cursor's row when `at` is given (its ties by id first). */
async function rowsOf(
  db: Db,
  input: Input,
  take: number,
  at?: { time: string; id: string; tie: boolean },
) {
  let query = db.from("inbound_mail").select(COLUMNS);
  if (input.source !== undefined) query = query.eq("source", input.source);
  if (input.state !== undefined) query = query.eq("state", input.state);
  if (at !== undefined)
    query = at.tie
      ? query.eq("received_at", at.time).lt("id", at.id)
      : query.lt("received_at", at.time);
  const { data, error } = await query
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return z.array(row).parse(data);
}

/**
 * `GET /api/admin/emails/inbound`: one keyset page of inbound mail, newest first, optionally one source and one state.
 * The cursor `received_at~id` names the last row of the page before (AND filters only: its ties, then older rows).
 */
export async function listInboundMail(
  actor: AdminActor,
  db: Db,
  input: Input,
): Promise<z.infer<typeof inboundMailListSchema>> {
  authorize(actor, "audit.list");
  const take = input.limit + 1;
  let found: Row[];
  if (input.cursor === undefined) found = await rowsOf(db, input, take);
  else {
    const [, time, id] = AFTER.exec(input.cursor) ?? [];
    if (time === undefined || id === undefined)
      throw new AppError("validation", undefined, "This page link is no longer valid.");
    found = await rowsOf(db, input, take, { time, id, tie: true });
    if (found.length < take)
      found = [
        ...found,
        ...(await rowsOf(db, input, take - found.length, { time, id, tie: false })),
      ];
  }
  const items = found.slice(0, input.limit);
  const last = found.length > input.limit ? items.at(-1) : undefined;
  return inboundMailListSchema.parse({
    items: items.map((item) => ({ ...item, triage: inboundTriage(item.triage) })),
    next_cursor: last === undefined ? null : `${last.received_at}~${last.id}`,
  });
}
