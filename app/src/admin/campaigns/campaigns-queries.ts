import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "../query";
import { fetchCampaigns } from "./campaigns-api";

export function useCampaigns() {
  return useQuery({ queryKey: adminKeys.campaigns.list(null), queryFn: fetchCampaigns });
}
