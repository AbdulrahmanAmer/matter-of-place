import {
  assigneesSchema,
  forwardAnswerSchema,
  inquiryDetailSchema,
  inquiryListSchema,
  inquiryStateAnswerSchema,
} from "../../domain/admin-inquiries";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 11. Components reach these through `inquiries-queries.ts`.

const inquiryPath = (id: string) => `/api/admin/inquiries/${id}`;

/** One page of inquiries; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchInquiries(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/inquiries${search === "" ? "" : `?${search}`}`, inquiryListSchema);
}

export function fetchInquiry(id: string) {
  return adminFetch(inquiryPath(id), inquiryDetailSchema);
}

export function fetchAssignees() {
  return adminFetch("/api/admin/inquiries/assignees", assigneesSchema);
}

export function assignInquiry(id: string, assignee: string) {
  return adminFetch(`${inquiryPath(id)}/assign`, inquiryStateAnswerSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignee }),
  });
}

export function forwardInquiry(id: string) {
  return adminFetch(`${inquiryPath(id)}/forward`, forwardAnswerSchema, { method: "POST" });
}

export function closeInquiry(id: string) {
  return adminFetch(`${inquiryPath(id)}/close`, inquiryStateAnswerSchema, { method: "POST" });
}
