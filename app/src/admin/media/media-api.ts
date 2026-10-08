import { z } from "zod";
import {
  attachAnswerSchema,
  mediaIdAnswerSchema,
  mediaListSchema,
  replaceAnswerSchema,
  reorderAnswerSchema,
  uploadUrlAnswerSchema,
  variantsStatusSchema,
  type MediaScope,
  type UploadType,
} from "../../domain/admin-media";
import { adminFetch, uploadSigned } from "../ui/admin-fetch";

// The browser side of screen 9 and the Sequence tab. Components reach these through `media-queries.ts`.

const send = (method: "POST" | "PATCH", body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const propertyQuery = (propertyId: string) =>
  `?${new URLSearchParams({ property_id: propertyId }).toString()}`;

export function fetchMedia(propertyId: string) {
  return adminFetch(`/api/admin/media${propertyQuery(propertyId)}`, mediaListSchema);
}

export function fetchVariantsStatus(propertyId: string) {
  return adminFetch(
    `/api/admin/media/variants-status${propertyQuery(propertyId)}`,
    variantsStatusSchema,
  );
}

/**
 * Stages one file of a type `uploadLimits` allows: an upload URL for its target, then the browser's own PUT to
 * Storage. `mediaId` makes it the replacement of that photograph.
 */
export async function stageFile(
  target: { scope: MediaScope; target: string; mediaId?: string },
  file: File,
  mime: UploadType,
) {
  const staged = await adminFetch(
    "/api/admin/media/upload-url",
    uploadUrlAnswerSchema,
    send("POST", {
      scope: target.scope,
      target: target.target,
      ...(target.mediaId === undefined ? {} : { media_id: target.mediaId }),
      mime,
      size: file.size,
    }),
  );
  await uploadSigned(staged.url, file);
  return staged;
}

export function attachMedia(body: { property_id: string; media_id: string; staging_path: string }) {
  return adminFetch("/api/admin/media/attach", attachAnswerSchema, send("POST", body));
}

export function reorderMedia(body: { property_id: string; order: string[] }) {
  return adminFetch("/api/admin/media/reorder", reorderAnswerSchema, send("POST", body));
}

export function setMediaAlt(id: string, alt: string) {
  return adminFetch(`/api/admin/media/${id}`, mediaIdAnswerSchema, send("PATCH", { alt }));
}

export function replaceMedia(id: string, stagingPath: string) {
  return adminFetch(
    `/api/admin/media/${id}/replace`,
    replaceAnswerSchema,
    send("POST", { staging_path: stagingPath }),
  );
}

export function deleteMedia(id: string) {
  return adminFetch(`/api/admin/media/${id}`, mediaIdAnswerSchema, { method: "DELETE" });
}

/** B8's retry of a failed job (screen 16's action, `jobs.retry`). */
export function retryJob(id: string) {
  return adminFetch(`/api/admin/jobs/${id}/retry`, z.unknown(), { method: "POST" });
}
