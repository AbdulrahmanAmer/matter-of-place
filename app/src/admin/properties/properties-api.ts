import {
  createFromSubmissionAnswerSchema,
  previewTokenAnswerSchema,
  propertyDetailSchema,
  propertyListSchema,
  publishAnswerSchema,
  representativeListSchema,
  representativePutAnswerSchema,
  versionAnswerSchema,
  type PropertyPatch,
  type RepresentativePut,
} from "../../domain/admin-properties";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screens 7 and 8. Components reach these through `properties-queries.ts`.

const propertyPath = (id: string) => `/api/admin/properties/${id}`;

const send = (method: "POST" | "PUT" | "PATCH", body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const withQuery = (path: string, query: Readonly<Record<string, string>>) => {
  const search = new URLSearchParams(query).toString();
  return search === "" ? path : `${path}?${search}`;
};

/** One page of properties; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchProperties(query: Readonly<Record<string, string>>) {
  return adminFetch(withQuery("/api/admin/properties", query), propertyListSchema);
}

export function fetchProperty(id: string) {
  return adminFetch(propertyPath(id), propertyDetailSchema);
}

export function createFromSubmission(submissionId: string) {
  return adminFetch(
    "/api/admin/properties/from-submission",
    createFromSubmissionAnswerSchema,
    send("POST", { submission_id: submissionId }),
  );
}

/** One autosave PATCH; resolves with the row's next version. */
export async function patchProperty(id: string, patch: PropertyPatch, expectedVersion: number) {
  const answer = await adminFetch(
    propertyPath(id),
    versionAnswerSchema,
    send("PATCH", { expected_version: expectedVersion, patch }),
  );
  return answer.version;
}

export function publishProperty(id: string, expectedVersion: number) {
  return adminFetch(
    `${propertyPath(id)}/publish`,
    publishAnswerSchema,
    send("POST", { expected_version: expectedVersion }),
  );
}

export function putRanks(
  id: string,
  ranks: { hero_rank: number | null; featured_rank: number | null },
  expectedVersion: number,
) {
  return adminFetch(
    `${propertyPath(id)}/rank`,
    versionAnswerSchema,
    send("PUT", { expected_version: expectedVersion, ...ranks }),
  );
}

export function putRelated(id: string, related: readonly string[], expectedVersion: number) {
  return adminFetch(
    `${propertyPath(id)}/related`,
    versionAnswerSchema,
    send("PUT", { expected_version: expectedVersion, related }),
  );
}

export function putFeatures(id: string, features: readonly string[], expectedVersion: number) {
  return adminFetch(
    `${propertyPath(id)}/features`,
    versionAnswerSchema,
    send("PUT", { expected_version: expectedVersion, features }),
  );
}

export function fetchRepresentatives(q: string) {
  return adminFetch(
    withQuery("/api/admin/properties/representatives", q === "" ? {} : { q }),
    representativeListSchema,
  );
}

export function putRepresentative(representative: RepresentativePut) {
  return adminFetch(
    "/api/admin/properties/representatives",
    representativePutAnswerSchema,
    send("POST", representative),
  );
}

export function issuePreviewToken(id: string) {
  return adminFetch(
    `${propertyPath(id)}/preview-token`,
    previewTokenAnswerSchema,
    send("POST", {}),
  );
}
