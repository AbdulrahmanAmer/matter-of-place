import { dashboardSchema, type Dashboard } from "../../domain/admin-dashboard";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";

/** `GET /api/admin/dashboard`: screen 2 in one `admin_dashboard()` call (invariant 17d), never cached (rule 9). */
export async function getDashboard(actor: AdminActor, db: Db): Promise<Dashboard> {
  authorize(actor, "dashboard.get");
  const { data, error } = await db.rpc("admin_dashboard");
  if (error !== null) throw fromRpcError(error);
  return dashboardSchema.parse(data);
}
