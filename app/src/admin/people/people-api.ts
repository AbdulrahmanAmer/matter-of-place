import {
  peopleListSchema,
  personDetailSchema,
  personNotesAnswerSchema,
} from "../../domain/admin-people";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screens 26 and 27. Components reach these through `people-queries.ts`.

const personPath = (id: string) => `/api/admin/people/${id}`;

/** One page of people; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchPeople(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/people${search === "" ? "" : `?${search}`}`, peopleListSchema);
}

export function fetchPerson(id: string) {
  return adminFetch(personPath(id), personDetailSchema);
}

/** Saves the whole notes text; `expectedUpdatedAt` is the version the editor started from. */
export function saveNotes(id: string, notes: string, expectedUpdatedAt: string) {
  return adminFetch(`${personPath(id)}/notes`, personNotesAnswerSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes, expected_updated_at: expectedUpdatedAt }),
  });
}
