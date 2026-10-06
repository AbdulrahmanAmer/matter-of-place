import type { Db } from "../lib/db.ts";

// Suppressions are written only by `apply_email_event` and B7's `opt_out_subject`; a send only asks.

/** Whether `email` is on the suppression list; the list holds lowercase addresses. */
export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const { data, error } = await db
    .from("email_suppressions")
    .select("email")
    .eq("email", email.toLowerCase())
    .limit(1);
  if (error !== null) throw new Error("email_read_failed:email_suppressions");
  return data.length > 0;
}
