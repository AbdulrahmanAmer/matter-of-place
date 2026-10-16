import {
  proposedDecisionSchema,
  proposedPostDetailSchema,
  proposedPostListSchema,
} from "./proposed-posts-contract";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of the Proposed posts screen: the item-10 routes and nothing else. Components reach these through
// `proposed-posts-queries.ts`.

const postPath = (id: string) => `/api/admin/proposed-posts/${id}`;

const asJson = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined
    ? {}
    : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/** The posts; `query` holds the filters exactly as the address has them. */
export function fetchProposedPosts(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(
    `/api/admin/proposed-posts${search === "" ? "" : `?${search}`}`,
    proposedPostListSchema,
  );
}

export function fetchProposedPost(id: string) {
  return adminFetch(postPath(id), proposedPostDetailSchema);
}

export function approveProposedPost(id: string) {
  return adminFetch(`${postPath(id)}/approve`, proposedDecisionSchema, asJson());
}

/** The note is required: it tells the next revision what was wrong. */
export function rejectProposedPost(id: string, note: string) {
  return adminFetch(`${postPath(id)}/reject`, proposedDecisionSchema, asJson({ note }));
}

export function rerenderProposedPost(id: string, note: string) {
  return adminFetch(`${postPath(id)}/rerender`, proposedDecisionSchema, asJson({ note }));
}
