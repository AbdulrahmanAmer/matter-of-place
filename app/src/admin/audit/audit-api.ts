import {
  auditPageSchema,
  subjectExportSchema,
  subjectFulfilledSchema,
  subjectRequestPageSchema,
  subjectStatusAnswer,
  type SubjectStatusAction,
} from "../../domain/admin-audit";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 25. Components reach this through `audit-queries.ts`.

/** One page of the audit log; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchAuditLog(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/audit${search === "" ? "" : `?${search}`}`, auditPageSchema);
}

const REQUESTS = "/api/admin/audit/subject-requests";

const post = (body: unknown = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** One page of data requests, newest first; `cursor` is the `next_cursor` of the page before. */
export function fetchSubjectRequests(cursor: string | null) {
  const search = cursor === null ? "" : `?${new URLSearchParams({ cursor }).toString()}`;
  return adminFetch(`${REQUESTS}${search}`, subjectRequestPageSchema);
}

export function postSubjectStatus(input: {
  id: string;
  action: SubjectStatusAction;
  note?: string;
}) {
  const { id, ...body } = input;
  return adminFetch(`${REQUESTS}/${id}/status`, subjectStatusAnswer, post(body));
}

export function postSubjectExport(id: string) {
  return adminFetch(`${REQUESTS}/${id}/export`, subjectExportSchema, post());
}

/** W8 item 4 round 2: the Instagram handle, when the person named one, is deleted with the request. */
export function postSubjectDelete(input: { id: string; instagram_handle?: string | undefined }) {
  const { id, ...body } = input;
  return adminFetch(`${REQUESTS}/${id}/delete`, subjectFulfilledSchema, post(body));
}

export function postSubjectOptOut(id: string) {
  return adminFetch(`${REQUESTS}/${id}/opt-out`, subjectFulfilledSchema, post());
}
