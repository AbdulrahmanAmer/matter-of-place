import { useQuery } from "@tanstack/react-query";
import { emailListSchema } from "../../domain/admin-emails";
import { adminKeys } from "../query";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of the Sent emails screen (W9 item 2, W7 item 1).

/** The newest emails for the filters as the address has them (`status`, `search`), and the do-not-send list. */
export function useSentEmails(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return useQuery({
    queryKey: adminKeys.emails.list(query),
    queryFn: () =>
      adminFetch(`/api/admin/emails${search === "" ? "" : `?${search}`}`, emailListSchema),
  });
}
