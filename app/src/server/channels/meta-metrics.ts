import { z } from "zod";
import type { Json } from "../../db/index.ts";
import type { Channel } from "./types.ts";

// The one table from Meta's insight names to the normalised metrics (B10 Outputs): when Meta renames a metric, this
// is the only file to edit. Every name is provisional until a live test post returns it (docs/runbooks/meta.md,
// "Insights"). `plays` is not on Meta's insights page and `impressions` is treated as deprecated there, so neither is
// in the table.

type Metrics = Extract<Awaited<ReturnType<Channel["metrics"]>>, { status: "fetched" }>["metrics"];
type MetricField = Exclude<keyof Metrics, "fetched_at" | "raw">;

export const META_METRICS: Readonly<Record<string, MetricField>> = {
  reach: "reach",
  views: "views",
  saved: "saves",
  shares: "shares",
  likes: "likes",
  comments: "comments",
};

const insightsSchema = z
  .object({
    data: z.array(
      z
        .object({
          name: z.string(),
          values: z.array(z.object({ value: z.unknown() }).passthrough()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * An insights answer as metrics: a name of the table fills its field, any other name is kept only in `raw`, and a
 * field Meta did not return stays null, never 0. `raw` is the answer untouched.
 */
export function normaliseMetaInsights(answer: Json, fetchedAt: Date): Metrics {
  const metrics: Metrics = {
    reach: null,
    views: null,
    saves: null,
    shares: null,
    likes: null,
    comments: null,
    clicks: null,
    fetched_at: fetchedAt.toISOString(),
    raw: answer,
  };
  for (const item of insightsSchema.safeParse(answer).data?.data ?? []) {
    const field = Object.hasOwn(META_METRICS, item.name) ? META_METRICS[item.name] : undefined;
    const value = item.values?.[0]?.value;
    if (field !== undefined && typeof value === "number") metrics[field] = value;
  }
  return metrics;
}
