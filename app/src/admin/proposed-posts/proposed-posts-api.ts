import {
  proposedPostDecisionSchema,
  proposedPostDetailSchema,
  proposedPostListSchema,
} from "../../domain/proposed-posts";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of the Proposed posts screen: the item-10 routes and nothing else. Components reach these through
// `proposed-posts-queries.ts`.

const postPath = (id: string) => `/api/admin/proposed-posts/${id}`;

const asJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** One keyset page of the posts; `query` holds the filters and the cursor exactly as the address has them. */
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

/** Names the revision the person saw: a newer one answers 409 "stale", and nothing is approved. */
export function approveProposedPost(id: string, revision: number) {
  return adminFetch(`${postPath(id)}/approve`, proposedPostDecisionSchema, asJson({ revision }));
}

/** The note is required: it tells the next revision what was wrong. */
export function rejectProposedPost(id: string, note: string) {
  return adminFetch(`${postPath(id)}/reject`, proposedPostDecisionSchema, asJson({ note }));
}

export function rerenderProposedPost(id: string, note: string) {
  return adminFetch(`${postPath(id)}/rerender`, proposedPostDecisionSchema, asJson({ note }));
}
