import { dashboardSchema } from "../../domain/admin-dashboard";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 2. Components reach it through `dashboard-queries.ts`.

export function fetchDashboard() {
  return adminFetch("/api/admin/dashboard", dashboardSchema);
}
