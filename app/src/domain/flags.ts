import { z } from "zod";

// `settings.flags` (GQ-05): boolean feature flags, snake_case in the database and in code (G18). Adding a flag is
// one name in `featureFlags` and one default in `defaultFlags`. `coming_soon` is not stored here: it is read from
// `settings.coming_soon_global`, so the code sees it as a flag without a second stored copy.
export const featureFlags = [
  "new_channels",
  "archive_pages",
  "csp_enforce",
  "maintenance",
] as const;
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
  csp_enforce: false,
  maintenance: false,
};

export type Flags = Record<FeatureFlag | "coming_soon", boolean>;

/** The one-line description of each flag in the editor of screen 24. */
export const flagLabels: Record<FeatureFlag, string> = {
  new_channels: "Lets Facebook and YouTube be switched on in channel settings.",
  archive_pages: "Publishes the market archive pages that have enough past properties.",
  csp_enforce: "Enforces the content security policy instead of only reporting it.",
  maintenance: "Answers public pages with a short maintenance notice.",
};

/** The write side of `flagsSchema` (invariant 14): an unknown name is refused, never dropped. */
export const flagsPutSchema = z.record(z.enum(featureFlags), z.boolean());
