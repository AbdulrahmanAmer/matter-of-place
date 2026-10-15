import { campaignListSchema } from "../../domain/admin-campaigns";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 33. Components reach it through `campaigns-queries.ts`.

export function fetchCampaigns() {
  return adminFetch("/api/admin/campaigns", campaignListSchema);
}
