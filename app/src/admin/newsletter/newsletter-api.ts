import {
  builtIssueSchema,
  issueListSchema,
  issueSchema,
  previewSchema,
  sendTestSchema,
  subscriberCountsSchema,
  type IssueUpdateInput,
} from "../../domain/admin-newsletter";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 13. Components reach these through `newsletter-queries.ts`.

const BASE = "/api/admin/newsletter";
const issuePath = (id: string) => `${BASE}/issues/${id}`;

/** Where the subscriber export downloads from; a link, not a fetch, so the browser saves the file. */
export const SUBSCRIBER_EXPORT_PATH = `${BASE}/subscribers/export`;

const post = (body: unknown = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchIssues() {
  return adminFetch(`${BASE}/issues`, issueListSchema);
}

export function fetchIssue(id: string) {
  return adminFetch(issuePath(id), issueSchema);
}

/** Builds the open draft from what was published since the last issue. */
export function buildIssue() {
  return adminFetch(`${BASE}/issues/build`, builtIssueSchema, post());
}

/** Saves the whole draft: blocks in reading order, subject and preheader. */
export function saveIssue(id: string, draft: Omit<IssueUpdateInput, "id">) {
  return adminFetch(issuePath(id), issueSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export function fetchPreview(id: string, viewport: "desktop" | "phone") {
  return adminFetch(`${issuePath(id)}/preview?viewport=${viewport}`, previewSchema);
}

/** `sendAt` is an ISO UTC instant; without it the issue goes out as soon as the runner takes the job. */
export function approveIssue(id: string, sendAt?: string) {
  return adminFetch(
    `${issuePath(id)}/approve`,
    issueSchema,
    post(sendAt === undefined ? {} : { send_at: sendAt }),
  );
}

export function unapproveIssue(id: string) {
  return adminFetch(`${issuePath(id)}/unapprove`, issueSchema, post());
}

export function sendTestIssue(id: string) {
  return adminFetch(`${issuePath(id)}/send-test`, sendTestSchema, post());
}

export function fetchSubscribers() {
  return adminFetch(`${BASE}/subscribers`, subscriberCountsSchema);
}
