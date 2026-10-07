import type { Json, Tables } from "../../db/index.ts";
import type { AssetKind } from "../../domain/assets.ts";
import type { SocialChannel } from "../../domain/channels.ts";
import type { StepContext } from "../jobs/types.ts";

/** The asset a channel posts: its own fields and the slug of its property, which the Facebook caption links to. */
export type SocialAsset = Pick<Tables<"assets">, "kind" | "files" | "caption" | "meta"> & {
  property_slug: string;
};

/** `skipped_disabled` is the disabled block's answer; `in_progress` is Meta's: the container exists and still processes. */
type PublishResult =
  | { status: "posted"; remoteId: string; permalink: string }
  | { status: "in_progress"; containerId: string }
  | { status: "skipped_disabled" };

type PostRef = { remoteId: string; permalink: string | null };

/** Every field a platform does not return stays null, never 0; `raw` keeps the platform's answer untouched. */
type Metrics = {
  reach: number | null;
  views: number | null;
  saves: number | null;
  shares: number | null;
  likes: number | null;
  comments: number | null;
  clicks: number | null;
  fetched_at: string;
  raw: Json;
};

type MetricsResult =
  | { status: "fetched"; metrics: Metrics }
  | { status: "skipped_budget" }
  | { status: "skipped_disabled" };

type HealthResult = { state: "disabled" } | { state: "ok" | "amber" | "red"; detail: string };

/** The extension point of every channel (S48): the registry in `index.ts` hands one out per name. */
export interface Channel {
  id: SocialChannel;
  supports(kind: AssetKind): boolean;
  publish(asset: SocialAsset, ctx: StepContext): Promise<PublishResult>;
  metrics(post: PostRef, ctx: StepContext): Promise<MetricsResult>;
  health(ctx: StepContext): Promise<HealthResult>;
}
