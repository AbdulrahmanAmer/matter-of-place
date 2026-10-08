import type { z } from "zod";
import {
  assetsReceivedAnswerSchema,
  decisionAnswerSchema,
  declineReasonsAnswerSchema,
  emailPreviewAnswerSchema,
  type emailPreviewSchema,
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

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The three decisions that send a letter; each answers its event and the jobs it started. */
export type Decision = "decline" | "accept" | "request-assets";

export function decide(id: string, decision: Decision, body: Readonly<Record<string, string>>) {
  return adminFetch(`${submissionPath(id)}/${decision}`, decisionAnswerSchema, postJson(body));
}

export function markAssetsReceived(id: string) {
  return adminFetch(
    `${submissionPath(id)}/assets-received`,
    assetsReceivedAnswerSchema,
    postJson({}),
  );
}

/** The letter a decision would send, with what the dialog holds; nothing is saved. */
export function previewEmail(id: string, body: Omit<z.input<typeof emailPreviewSchema>, "id">) {
  return adminFetch(
    `${submissionPath(id)}/email-preview`,
    emailPreviewAnswerSchema,
    postJson(body),
  );
}

export function fetchDeclineReasons() {
  return adminFetch("/api/admin/submissions/decline-reasons", declineReasonsAnswerSchema);
}
