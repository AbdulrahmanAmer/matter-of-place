import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "../query";
import { fetchUsage } from "./usage-api";

/** Under the settings key, so a settings write reads the gauges again with the rest. */
export function useUsage() {
  return useQuery({
    queryKey: adminKeys.settings.list({ usage: true }),
    queryFn: fetchUsage,
  });
}
