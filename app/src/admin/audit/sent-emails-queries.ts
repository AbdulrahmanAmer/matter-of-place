import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emailListSchema, replyListSchema, replyMarkAnswerSchema } from "../../domain/admin-emails";
import { adminKeys, invalidateAfterWrite } from "../query";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of the Sent emails screen (W9 item 2, W7 items 1 and 2).

/** The newest emails for the filters as the address has them (`status`, `search`), and the do-not-send list. */
export function useSentEmails(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return useQuery({
    queryKey: adminKeys.emails.list(query),
    queryFn: () =>
      adminFetch(`/api/admin/emails${search === "" ? "" : `?${search}`}`, emailListSchema),
  });
}

/** The newest replies to our email, all of them or one state (W7 item 2). */
export function useReplies(state: string | undefined) {
  const search = state === undefined ? "" : `?state=${encodeURIComponent(state)}`;
  return useQuery({
    queryKey: adminKeys.emails.list({ replies: state ?? null }),
    queryFn: () => adminFetch(`/api/admin/emails/replies${search}`, replyListSchema),
  });
}

/** Marks a reply seen, answered or ignored; the replies are read again after it. */
export function useMarkReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: "seen" | "answered" | "ignored" }) =>
      adminFetch(`/api/admin/emails/replies/${id}`, replyMarkAnswerSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.emails.all()),
  });
}
