import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PropertyPatch, RepresentativePut } from "../../domain/admin-properties";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  createFromSubmission,
  fetchProperties,
  fetchProperty,
  fetchRepresentatives,
  issuePreviewToken,
  patchProperty,
  publishProperty,
  putFeatures,
  putRanks,
  putRelated,
  putRepresentative,
} from "./properties-api";

/** The filters of screen 7 that live in the address, beside the cursor. */
export const propertyFilterNames = ["editorial_state", "market"] as const;

export type PropertyFilterName = (typeof propertyFilterNames)[number];

export function useProperties(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.properties.list(query),
    queryFn: () => fetchProperties(query),
  });
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: adminKeys.properties.detail(id),
    queryFn: () => fetchProperty(id),
  });
}

export function useRepresentatives(q: string) {
  return useQuery({
    queryKey: [...adminKeys.properties.all(), "representatives", q],
    queryFn: () => fetchRepresentatives(q),
  });
}

/** A write of one property: its feature, the dashboard and its timeline are read again once it settles. */
function usePropertyWrite<Input, Answer>(id: string, write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.properties.all(),
        adminKeys.properties.timeline(id),
      ),
  });
}

export function useCreateFromSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createFromSubmission,
    onSettled: () =>
      Promise.all([
        invalidateAfterWrite(queryClient, adminKeys.properties.all()),
        queryClient.invalidateQueries({ queryKey: adminKeys.submissions.all() }),
      ]),
  });
}

export function useSavePatch(id: string) {
  return usePropertyWrite(id, (input: { patch: PropertyPatch; version: number }) =>
    patchProperty(id, input.patch, input.version),
  );
}

export function usePublish(id: string) {
  return usePropertyWrite(id, (version: number) => publishProperty(id, version));
}

export function useRanks(id: string) {
  return usePropertyWrite(
    id,
    (input: { hero_rank: number | null; featured_rank: number | null; version: number }) =>
      putRanks(
        id,
        { hero_rank: input.hero_rank, featured_rank: input.featured_rank },
        input.version,
      ),
  );
}

export function useRelated(id: string) {
  return usePropertyWrite(id, (input: { related: string[]; version: number }) =>
    putRelated(id, input.related, input.version),
  );
}

export function useFeatures(id: string) {
  return usePropertyWrite(id, (input: { features: string[]; version: number }) =>
    putFeatures(id, input.features, input.version),
  );
}

export function usePutRepresentative(id: string) {
  return usePropertyWrite(id, (representative: RepresentativePut) =>
    putRepresentative(representative),
  );
}

/** A fresh 15 minute draft link for the Preview tab; nothing is stored, so nothing is invalidated. */
export function usePreviewToken(id: string) {
  return useMutation({ mutationFn: () => issuePreviewToken(id) });
}
