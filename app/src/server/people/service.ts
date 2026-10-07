import { z } from "zod";
import {
  personDetailSchema,
  personListRowSchema,
  type PeopleListInput,
  type PersonDetail,
  type PersonListRow,
  type PersonNotesInput,
} from "../../domain/admin-people";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";

// Screens 26 and 27 (B7 step 5a, invariant 23, S55): one RPC per call, each after `authorize` (SEC-04).

const listRowsSchema = z.array(personListRowSchema);

/** A page starts after the row it names: its id, then its name exactly as listed. */
const CURSOR = /^([0-9a-f-]{36})~([\s\S]*)$/;

const cursorOf = (row: PersonListRow): string => `${row.id}~${row.name}`;

function afterCursor(cursor: string): { p_cursor_id: string; p_cursor_name: string } {
  const [, id, name] = CURSOR.exec(cursor) ?? [];
  if (id === undefined || name === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  return { p_cursor_id: id, p_cursor_name: name };
}

/**
 * `GET /api/admin/people`: one page in name order through `people_list` (invariant 17c, R44). The function caps a page
 * at 50 rows, so a full page carries a cursor, and when no row follows it the next page is empty.
 */
export async function listPeople(
  actor: AdminActor,
  db: Db,
  input: PeopleListInput,
): Promise<{ items: PersonListRow[]; next_cursor: string | null }> {
  authorize(actor, "people.list");
  const { data, error } = await db.rpc("people_list", {
    p_limit: input.limit,
    ...(input.search === undefined ? {} : { p_search: input.search }),
    ...(input.kind === undefined ? {} : { p_kind: input.kind }),
    ...(input.cursor === undefined ? {} : afterCursor(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  const items = listRowsSchema.parse(data);
  const last = items.at(-1);
  return {
    items,
    next_cursor: items.length === input.limit && last !== undefined ? cursorOf(last) : null,
  };
}

/** `GET /api/admin/people/:id`: the person and the five lists of screen 27 through `person_detail`. */
export async function getPerson(actor: AdminActor, db: Db, id: string): Promise<PersonDetail> {
  authorize(actor, "people.get");
  const { data, error } = await db.rpc("person_detail", { p_contact_id: id });
  if (error !== null) throw fromRpcError(error);
  return personDetailSchema.parse(data);
}

/** `PUT /api/admin/people/:id/notes`: the whole notes text through `set_contact_notes`; answers the new `updated_at`. */
export async function setPersonNotes(
  actor: AdminActor,
  db: Db,
  id: string,
  input: Omit<PersonNotesInput, "id">,
): Promise<{ updated_at: string }> {
  authorize(actor, "people.note");
  const { data, error } = await db.rpc("set_contact_notes", {
    p_contact_id: id,
    p_notes: input.notes,
    p_expected_updated_at: input.expected_updated_at,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { updated_at: data };
}
