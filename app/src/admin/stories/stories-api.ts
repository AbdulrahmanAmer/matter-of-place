import {
  storyDetailSchema,
  storyListSchema,
  storySavedSchema,
  type StoryPatch,
} from "../../domain/admin-stories";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 14. Components reach these through `stories-queries.ts`.

const storyPath = (id: string) => `/api/admin/stories/${id}`;

const send = (method: "POST" | "PATCH", body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** One page of stories; `query` holds the filter and the cursor exactly as the address has them. */
export function fetchStories(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/stories${search === "" ? "" : `?${search}`}`, storyListSchema);
}

export function fetchStory(id: string) {
  return adminFetch(storyPath(id), storyDetailSchema);
}

export function createStory(body: { patch: StoryPatch; image_staging_path?: string }) {
  return adminFetch("/api/admin/stories", storySavedSchema, send("POST", body));
}

export function patchStory(
  id: string,
  body: { expected_updated_at: string; patch: StoryPatch; image_staging_path?: string },
) {
  return adminFetch(storyPath(id), storySavedSchema, send("PATCH", body));
}

export function publishStory(id: string, expectedUpdatedAt: string) {
  return adminFetch(
    `${storyPath(id)}/publish`,
    storySavedSchema,
    send("POST", { expected_updated_at: expectedUpdatedAt }),
  );
}

export function unpublishStory(id: string) {
  return adminFetch(`${storyPath(id)}/unpublish`, storySavedSchema, { method: "POST" });
}
