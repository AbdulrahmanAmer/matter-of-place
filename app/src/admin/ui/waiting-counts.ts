import { useQuery } from "@tanstack/react-query";
import type { Dashboard } from "../../domain/admin-dashboard";
import type { AgentApproval } from "../../domain/workforce";
import { fetchDashboard } from "../dashboard/dashboard-api";
import { adminKeys } from "../query";
import { fetchApprovals } from "../workforce/workforce-api";
import { useAdminMe } from "./admin-me";

// W3 stage 5: how many things wait on a person, by screen, for the tabs and the rail. It reads the dashboard's and
// the approvals' own queries, so it shares their cache and adds no request a screen does not already make.

/** Screen number to the count of what waits there; a screen with nothing to count is absent. */
export function waitingByScreen(
  dashboard:
    | (Pick<Dashboard, "jobs" | "assets_pending"> & {
        counts: Partial<Record<string, number>>;
      })
    | undefined,
  approvals: readonly Pick<AgentApproval, "state">[] | undefined,
): Record<number, number> {
  const counts: Record<number, number> = {};
  if (approvals !== undefined)
    counts[29] = approvals.filter((item) => item.state === "pending").length;
  if (dashboard !== undefined) {
    counts[3] = (dashboard.counts["Submitted"] ?? 0) + (dashboard.counts["Under Review"] ?? 0);
    counts[10] = dashboard.assets_pending;
    counts[16] = dashboard.jobs.failed_24h + dashboard.jobs.dead;
  }
  return counts;
}

export function useWaitingCounts(): Record<number, number> {
  const { actions } = useAdminMe();
  const dashboard = useQuery({
    queryKey: adminKeys.dashboard(),
    queryFn: fetchDashboard,
    enabled: actions.includes("dashboard.get"),
  });
  const approvals = useQuery({
    queryKey: adminKeys.workforce.list("approvals"),
    queryFn: fetchApprovals,
    enabled: actions.includes("workforce.approvals"),
  });
  return waitingByScreen(dashboard.data, approvals.data?.items);
}
