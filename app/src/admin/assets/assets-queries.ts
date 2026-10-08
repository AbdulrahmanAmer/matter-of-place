import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssetCaptionInput } from "../../domain/admin-assets";
import { adminKeys, invalidateAfterWrite } from "../query";
import { approveAsset, editCaption, fetchAssets, rejectAsset, rerenderAsset } from "./assets-api";

/** The filters of screen 10 that live in the address; `page` counts from 1 and `property_id` is the open property. */
export const assetFilterNames = ["status", "kind", "property_id", "page"] as const;

export function useAssets(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.assets.list(query),
    queryFn: () => fetchAssets(query),
  });
}

function useAssetWrite<Variables, Answer>(write: (variables: Variables) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.assets.all()),
  });
}

export function useApproveAsset() {
  return useAssetWrite(approveAsset);
}

export function useRejectAsset() {
  return useAssetWrite(({ id, note }: { id: string; note: string }) => rejectAsset(id, note));
}

/** One call for each id, all at once; the answers keep the order of `ids`. */
export function useRerenderAssets() {
  return useAssetWrite((ids: readonly string[]) => Promise.all(ids.map(rerenderAsset)));
}

export function useEditCaption() {
  return useAssetWrite(({ id, ...edit }: AssetCaptionInput) => editCaption(id, edit));
}
