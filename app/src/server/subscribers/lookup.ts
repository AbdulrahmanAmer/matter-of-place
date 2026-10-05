import type { Db } from "../lib/db.ts";

/** One subscriber's id and nothing else: a sample payload needs to know the row exists, never an address (R38). */
export const subscriberIdQuery = (db: Db, id: string) =>
  db.from("subscribers").select("id").eq("id", id);
