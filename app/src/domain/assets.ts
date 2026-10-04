import { z } from "zod";
import type { Enums } from "../db/index.ts";

// The generated creative of a property (B9, architecture 3.6). Field names equal the `assets` columns and the API JSON.

export type AssetKind = Enums<"asset_kind">;
export type AssetStatus = Enums<"asset_status">;

/** The kinds a human approves; `variants` is in the database enum for parity but no step writes a row of it. */
export const assetKinds = [
  "cover",
  "carousel",
  "story",
  "reel",
  "newsletter_block",
  "standalone_email",
] as const;

export const assetStatuses = ["pending", "approved", "rejected", "published"] as const;

export const assetKindLabels: Record<(typeof assetKinds)[number], string> = {
  cover: "Cover",
  carousel: "Carousel",
  story: "Story",
  reel: "Reel",
  newsletter_block: "Newsletter block",
  standalone_email: "Standalone email",
};

export const assetStatusLabels: Record<(typeof assetStatuses)[number], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
};

/** Consumers pick a file by `role`, never by position. */
export const assetFileRoles = [
  "main",
  "slide",
  "x",
  "linkedin",
  "linkedin_set",
  "video",
  "poster",
] as const;

/** One element of `assets.files`; `index` counts from 0 on `slide` and `linkedin_set`. */
export const assetFileSchema = z.object({
  media_key: z.string().min(1),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
  role: z.enum(assetFileRoles),
  index: z.number().int().nonnegative().optional(),
});
export type AssetFile = z.infer<typeof assetFileSchema>;

export const assetListFilters = z.object({
  status: z.enum(assetStatuses).optional(),
  kind: z.enum(assetKinds).optional(),
  property_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AssetListFilters = z.infer<typeof assetListFilters>;

/** The pages that have a static Open Graph card (G5); `default` serves every page that has none of its own. */
export const ogStaticKeys = [
  "home",
  "markets",
  "market-california",
  "market-new-york",
  "market-florida",
  "stories",
  "default",
] as const;
