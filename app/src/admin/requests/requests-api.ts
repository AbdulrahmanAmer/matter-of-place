import {
  originalAnswerSchema,
  startReviewAnswerSchema,
  submissionDetailSchema,
  submissionListSchema,
  submissionNoteSchema,
  timelineAnswerSchema,
} from "../../domain/admin-submissions";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screens 3 and 4. Components reach these through `requests-queries.ts`.

const submissionPath = (id: string) => `/api/admin/submissions/${id}`;

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

export function fetchSubmission(id: string) {
  return adminFetch(submissionPath(id), submissionDetailSchema);
}

export function fetchTimeline(id: string) {
  return adminFetch(`${submissionPath(id)}/timeline`, timelineAnswerSchema);
}

export function addNote(id: string, text: string) {
  return adminFetch(`${submissionPath(id)}/note`, submissionNoteSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** The ten-minute address of one original, asked for only when the editor opens it. */
export function fetchOriginal(id: string, mediaId: string) {
  return adminFetch(`${submissionPath(id)}/media/${mediaId}/original`, originalAnswerSchema);
}
