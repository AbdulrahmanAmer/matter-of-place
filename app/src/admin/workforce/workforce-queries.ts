import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HireInput } from "../../domain/workforce";
import { adminKeys } from "../query";
import {
  fetchApprovals,
  fetchDecisions,
  fetchInstructionText,
  fetchInstructionVersions,
  fetchLessons,
  fetchMessages,
  fetchOffice,
  postAgentState,
  postDecision,
  postHire,
  postMessage,
} from "./workforce-api";

// W1: the office is live: the team's state every 5 seconds, the open conversation every 4.

export function useOffice() {
  return useQuery({
    queryKey: adminKeys.workforce.list("office"),
    queryFn: fetchOffice,
    refetchInterval: 5_000,
  });
}

export function useMessages(thread: string) {
  return useQuery({
    queryKey: adminKeys.workforce.timeline(thread),
    queryFn: () => fetchMessages(thread),
    refetchInterval: 4_000,
  });
}

export function usePostMessage(thread: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => postMessage(thread, body),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.workforce.all() }),
  });
}

export function useHire() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HireInput) => postHire(input),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.workforce.all() }),
  });
}

export function useAgentState() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, state }: { slug: string; state: "idle" | "paused" | "off" }) =>
      postAgentState(slug, state),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.workforce.all() }),
  });
}

export function useApprovals() {
  return useQuery({
    queryKey: adminKeys.workforce.list("approvals"),
    queryFn: fetchApprovals,
    refetchInterval: 10_000,
  });
}

export function useDecide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      contentHash,
      reason,
      editedBody,
    }: {
      id: string;
      decision: "approved" | "rejected";
      contentHash: string;
      reason?: string;
      editedBody?: string;
    }) =>
      postDecision(id, decision, contentHash, {
        ...(reason === undefined ? {} : { reason }),
        ...(editedBody === undefined ? {} : { editedBody }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.workforce.all() }),
  });
}

// W7 item 4: the team's memory changes once a day at most; a minute is fresh enough.
const MEMORY_REFRESH = 60_000;

export function useDecisions() {
  return useQuery({
    queryKey: adminKeys.workforce.list("memory-decisions"),
    queryFn: fetchDecisions,
    refetchInterval: MEMORY_REFRESH,
  });
}

export function useLessons() {
  return useQuery({
    queryKey: adminKeys.workforce.list("memory-lessons"),
    queryFn: fetchLessons,
    refetchInterval: MEMORY_REFRESH,
  });
}

export function useInstructionVersions() {
  return useQuery({
    queryKey: adminKeys.workforce.list("memory-instructions"),
    queryFn: fetchInstructionVersions,
    refetchInterval: MEMORY_REFRESH,
  });
}

/** The text of one version, fetched only once a person opens it; a saved version never changes. */
export function useInstructionText(id: string | null) {
  return useQuery({
    queryKey: adminKeys.workforce.detail(id ?? ""),
    queryFn: () => fetchInstructionText(id ?? ""),
    enabled: id !== null,
    staleTime: Infinity,
  });
}
