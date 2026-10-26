// The client room's fixtures (W6 items 7 and 8): an auth user with a confirmed address, and the contact that address
// names. A client is the person whose confirmed auth email is a contact's (ruling H119), so a room test needs both.
import { createAuthUser, type Db } from "./db";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The list at `key` of a page's answer (the answer itself when `key` is left out), as plain records. */
export function rowsOf(answer: unknown, key?: string): Record<string, unknown>[] {
  const list = key === undefined ? answer : isRecord(answer) ? answer[key] : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** The ids of `rows`, sorted, to compare which rows an answer holds. */
export const idsOf = (rows: Record<string, unknown>[]): string[] =>
  rows.map((row) => String(row["id"])).sort();

/** An auth user with `email`, confirmed unless `confirmed` is false. */
export async function person(db: Db, email: string, confirmed = true): Promise<string> {
  const id = await createAuthUser(db);
  await db.query(
    "update auth.users set email = $2, email_confirmed_at = case when $3 then now() end where id = $1",
    [id, email, confirmed],
  );
  return id;
}

/** A contact with `email`, archived when `archived` is true. */
export async function contact(db: Db, email: string, archived = false): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.contacts (kind, name, email, archived_at)
     values ('owner', 'Test Owner', $1, case when $2 then now() end) returning id`,
    [email, archived],
  );
  return rows[0]?.id ?? "";
}
