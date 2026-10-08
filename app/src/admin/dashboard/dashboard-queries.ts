import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "../query";
import { fetchDashboard } from "./dashboard-api";

/** Every write's `onSettled` invalidates this key (`invalidateAfterWrite`), so the counts follow the day. */
export function useDashboard() {
  return useQuery({ queryKey: adminKeys.dashboard(), queryFn: fetchDashboard });
}
