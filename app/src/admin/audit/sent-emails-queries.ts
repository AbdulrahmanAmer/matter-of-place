import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { z } from "zod";
import { emailListSchema, replyListSchema, replyMarkAnswerSchema } from "../../domain/admin-emails";
import { inboundMailListSchema } from "../../domain/admin-inbound-mail";
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

/** One page of the newest replies to our email: all of them or one state, from the cursor on (W7 item 2). */
export function useReplies(state: string | undefined, cursor: string | null) {
  const search = new URLSearchParams();
  if (state !== undefined) search.set("state", state);
  if (cursor !== null) search.set("cursor", cursor);
  const query = search.size === 0 ? "" : `?${search.toString()}`;
  return useQuery({
    queryKey: adminKeys.emails.list({ replies: state ?? null, cursor }),
    queryFn: () => adminFetch(`/api/admin/emails/replies${query}`, replyListSchema),
  });
}

/** One page of the mail that reached our addresses: one source and one state or all, from the cursor on (W8 0h). */
export function useInboundMail(
  filters: { source?: string | undefined; state?: string | undefined },
  cursor: string | null,
) {
  const search = new URLSearchParams();
  if (filters.source !== undefined) search.set("source", filters.source);
  if (filters.state !== undefined) search.set("state", filters.state);
  if (cursor !== null) search.set("cursor", cursor);
  const query = search.size === 0 ? "" : `?${search.toString()}`;
  return useQuery({
    queryKey: adminKeys.emails.list({
      inbound: filters.source ?? null,
      inboundState: filters.state ?? null,
      cursor,
    }),
    queryFn: () => adminFetch(`/api/admin/emails/inbound${query}`, inboundMailListSchema),
  });
}

/** True for the cached pages of replies (the key `useReplies` gives them), not the sent emails. */
function isRepliesQuery(queryKey: QueryKey): boolean {
  const filters = queryKey[3];
  return typeof filters === "object" && filters !== null && "replies" in filters;
}

type ReplyAnswer = z.infer<typeof replyMarkAnswerSchema>;

/**
 * Marks a reply seen, answered or ignored. Opening a reply marks it seen: that is written into the pages already
 * read, so a reply opened under the filter "new" stays in front of the person; the pages are read again later.
 * Answered and ignored read the emails again at once.
 */
export function useMarkReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: "seen" | "answered" | "ignored" }) =>
      adminFetch(`/api/admin/emails/replies/${id}`, replyMarkAnswerSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    onSuccess: (answer: ReplyAnswer, { state }) => {
      if (state !== "seen") return;
      queryClient.setQueriesData<z.infer<typeof replyListSchema>>(
        { queryKey: adminKeys.emails.all(), predicate: (query) => isRepliesQuery(query.queryKey) },
        (page) =>
          page === undefined
            ? page
            : {
                ...page,
                items: page.items.map((item) =>
                  item.id === answer.id ? { ...item, state: answer.state } : item,
                ),
              },
      );
    },
    onSettled: (_answer, _error, { state }) =>
      state === "seen"
        ? queryClient.invalidateQueries({ queryKey: adminKeys.emails.all(), refetchType: "none" })
        : invalidateAfterWrite(queryClient, adminKeys.emails.all()),
  });
}
