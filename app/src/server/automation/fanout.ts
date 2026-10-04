import type { Db } from "../lib/db.ts";

// STUB(B8b step 4): planner fan-out
export function fanoutPendingEvents(_db: Db, _limit: number): Promise<number> {
  return Promise.resolve(0);
}
