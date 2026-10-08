import { reportEmailAnswer, reportListSchema, reportSchema } from "../../domain/admin-reports";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 22. Components reach these through `reports-queries.ts`.

/** One page of reports; `query` holds the campaign filter and the page exactly as `GET /api/admin/reports` takes them. */
export function fetchReports(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/reports${search === "" ? "" : `?${search}`}`, reportListSchema);
}

export function fetchReport(id: string) {
  return adminFetch(`/api/admin/reports/${id}`, reportSchema);
}

/** Queues the report for the person who submitted the property; a second click in the same minute is `duplicate`. */
export function emailReport(id: string) {
  return adminFetch(`/api/admin/reports/${id}/email`, reportEmailAnswer, { method: "POST" });
}
