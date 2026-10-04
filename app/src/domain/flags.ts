import { z } from "zod";

// `settings.flags` (GQ-05): boolean feature flags, snake_case in the database and in code (G18). Adding a flag is
// one name in `featureFlags` and one default in `defaultFlags`. `coming_soon` is not stored here: it is read from
// `settings.coming_soon_global`, so the code sees it as a flag without a second stored copy.
export const featureFlags = ["new_channels", "archive_pages"] as const;
export type FeatureFlag = (typeof featureFlags)[number];

const isFeatureFlag = (key: string): key is FeatureFlag =>
  featureFlags.some((flag) => flag === key);

/** A stored row: known keys to booleans, any other key dropped, any other shape refused. */
export const flagsSchema = z.preprocess(
  (row) =>
    typeof row === "object" && row !== null
      ? Object.fromEntries(Object.entries(row).filter(([key]) => isFeatureFlag(key)))
      : row,
  z.record(z.enum(featureFlags), z.boolean()),
);

export const defaultFlags: Record<FeatureFlag, boolean> = {
  new_channels: false,
  archive_pages: false,
};

export type Flags = Record<FeatureFlag | "coming_soon", boolean>;
