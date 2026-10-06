import { startReviewAnswerSchema, submissionListSchema } from "../../domain/admin-submissions";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 3. Components reach these through `requests-queries.ts`.

/** One page of requests; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchSubmissions(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(
    `/api/admin/submissions${search === "" ? "" : `?${search}`}`,
    submissionListSchema,
  );
}

/** Starts the review of every request in `ids`, or of none when one of them has moved on. */
export function startReview(ids: readonly string[]) {
  return adminFetch("/api/admin/submissions/start-review", startReviewAnswerSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}
