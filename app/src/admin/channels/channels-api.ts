import { z } from "zod";
import {
  channelHealthListSchema,
  channelIdsAnswerSchema,
  socialPostListSchema,
  type ChannelIdsKey,
} from "../../domain/channels";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 12 and the screen 2 tile. Components reach these through `channels-queries.ts`.

const postPath = (id: string) => `/api/admin/channels/posts/${id}`;

const jobAnswer = z.object({ job_id: z.string() });

/** One page of posts; `query` holds the filters and the page exactly as `GET /api/admin/channels/posts` takes them. */
export function fetchPosts(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(
    `/api/admin/channels/posts${search === "" ? "" : `?${search}`}`,
    socialPostListSchema,
  );
}

export function fetchHealth() {
  return adminFetch("/api/admin/channels/health", channelHealthListSchema);
}

export function retryPost(id: string) {
  return adminFetch(`${postPath(id)}/retry`, jobAnswer, { method: "POST" });
}

export function cancelPost(id: string) {
  return adminFetch(`${postPath(id)}/cancel`, z.object({ cancelled: z.literal(true) }), {
    method: "POST",
  });
}

export function refreshMetrics(id: string) {
  return adminFetch(`${postPath(id)}/metrics-refresh`, jobAnswer, { method: "POST" });
}

export function markWithdrawn(id: string) {
  return adminFetch(`${postPath(id)}/withdrawn`, z.object({ withdrawn: z.literal(true) }), {
    method: "POST",
  });
}

/** Stores the non-secret ids of one channel; `fields` are the ones the person filled in. */
export function saveIds(key: ChannelIdsKey, fields: Readonly<Record<string, unknown>>) {
  return adminFetch(`/api/admin/channels/ids/${key}`, channelIdsAnswerSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}
