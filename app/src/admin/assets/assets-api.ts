import {
  assetCaptionAnswerSchema,
  assetDecisionSchema,
  assetListSchema,
  assetRerenderSchema,
  type AssetCaptionInput,
} from "../../domain/admin-assets";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 10. Components reach these through `assets-queries.ts`.

const assetPath = (id: string) => `/api/admin/assets/${id}`;

const asJson = (method: "POST" | "PUT", body?: unknown): RequestInit => ({
  method,
  ...(body === undefined
    ? {}
    : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/** One page of assets; `query` holds the filters and the page exactly as the address has them. */
export function fetchAssets(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/assets${search === "" ? "" : `?${search}`}`, assetListSchema);
}

export function approveAsset(id: string) {
  return adminFetch(`${assetPath(id)}/approve`, assetDecisionSchema, asJson("POST"));
}

/** The note is required: the database refuses a reject without one. */
export function rejectAsset(id: string, note: string) {
  return adminFetch(`${assetPath(id)}/reject`, assetDecisionSchema, asJson("POST", { note }));
}

/** A new pending revision and the job that renders it. */
export function rerenderAsset(id: string) {
  return adminFetch(`${assetPath(id)}/rerender`, assetRerenderSchema, asJson("POST"));
}

export function editCaption(id: string, edit: Omit<AssetCaptionInput, "id">) {
  return adminFetch(`${assetPath(id)}/caption`, assetCaptionAnswerSchema, asJson("PUT", edit));
}
