import { usageAnswerSchema } from "../../domain/admin-usage";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of Settings, Service usage (W7 item 7). The component reaches it through `usage-queries.ts`.

export function fetchUsage() {
  return adminFetch("/api/admin/settings/usage", usageAnswerSchema);
}
