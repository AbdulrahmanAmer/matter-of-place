import { useQuery } from "@tanstack/react-query";
import { adminSearchAnswerSchema } from "../../domain/admin-search";
import { adminFetch } from "../ui/admin-fetch";

// The top bar's search (W3, admin pass): one request a settled query, kept a minute so going back costs nothing.

function fetchSearch(q: string) {
  return adminFetch(`/api/admin/search?q=${encodeURIComponent(q)}`, adminSearchAnswerSchema);
}

/** Results for `q` once it has two characters; nothing is asked before. */
export function useAdminSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: ["admin", "search", text] as const,
    queryFn: () => fetchSearch(text),
    enabled: text.length >= 2,
    staleTime: 60_000,
  });
}
