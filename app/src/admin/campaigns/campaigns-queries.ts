import { useQuery } from "@tanstack/react-query";
import { fetchCampaigns } from "./campaigns-api";

// STUB(W7 item 3 follow-up): `adminKeys` (src/admin/query.ts) gets `campaigns: feature("campaigns")` in a change that
// owns that file; until then the key is rooted at `["admin"]` here, so the admin query defaults still apply.
const campaignsKey = ["admin", "campaigns", "list"] as const;

export function useCampaigns() {
  return useQuery({ queryKey: campaignsKey, queryFn: fetchCampaigns });
}
