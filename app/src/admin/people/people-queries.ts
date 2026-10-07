import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import { fetchPeople, fetchPerson, saveNotes } from "./people-api";

/** The filters of screen 26 that live in the address, beside the cursor. */
export const peopleFilterNames = ["search", "kind"] as const;

export type PeopleFilterName = (typeof peopleFilterNames)[number];

export function usePeople(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.people.list(query),
    queryFn: () => fetchPeople(query),
  });
}

export function usePerson(id: string) {
  return useQuery({
    queryKey: adminKeys.people.detail(id),
    queryFn: () => fetchPerson(id),
  });
}

export function useSaveNotes(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ notes, expectedUpdatedAt }: { notes: string; expectedUpdatedAt: string }) =>
      saveNotes(id, notes, expectedUpdatedAt),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.people.all()),
  });
}
