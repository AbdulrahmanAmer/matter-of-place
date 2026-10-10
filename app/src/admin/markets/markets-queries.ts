import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarketUpdateInput } from "../../domain/admin-markets";
import type { UploadType } from "../../domain/admin-media";
import { stageFile } from "../media/media-api";
import { adminKeys, invalidateAfterWrite } from "../query";
import { fetchMarket, fetchMarkets, patchMarket, postComingSoon } from "./markets-api";

export function useMarkets() {
  return useQuery({
    queryKey: adminKeys.markets.list({}),
    queryFn: fetchMarkets,
  });
}

export function useMarket(slug: string) {
  return useQuery({
    queryKey: adminKeys.markets.detail(slug),
    queryFn: () => fetchMarket(slug),
  });
}

/** A write of markets: the feature and the dashboard are read again once it settles. */
function useMarketWrite<Input, Answer>(write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.markets.all()),
  });
}

export const useSaveMarket = () =>
  useMarketWrite(({ slug, ...body }: { slug: string } & Omit<MarketUpdateInput, "slug">) =>
    patchMarket(slug, body),
  );

export const useSetComingSoon = () =>
  useMarketWrite(({ slug, comingSoon }: { slug: string; comingSoon: boolean }) =>
    postComingSoon(slug, comingSoon),
  );

/** The image of a market goes to the staging folder of its slug; nothing is stored in the row until the render ran. */
export const stageMarketImage = (slug: string, file: File, mime: UploadType) =>
  stageFile({ scope: "market", target: slug }, file, mime);

/** A region's image goes to the staging folder of the region. */
export const stageRegionImage = (slug: string, file: File, mime: UploadType) =>
  stageFile({ scope: "region", target: slug }, file, mime);
