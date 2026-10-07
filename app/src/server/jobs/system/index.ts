import type { SystemJobDefinition } from "../types.ts";
import { health } from "./health.ts";
import { marketOpenNotice } from "./market-open-notice.ts";
import { metaTokenRefresh } from "./meta-token-refresh.ts";
import { newsletterPreview } from "./newsletter-preview.ts";
import { newsletterSend } from "./newsletter-send.ts";
import { prune } from "./prune.ts";
import { reconcile } from "./reconcile.ts";
import { retention } from "./retention.ts";

// System jobs (health, prune, reconcile, retention and the rest): each slice appends one import and one entry. They
// are runnable but never selectable in a recipe.
const systemJobs: readonly SystemJobDefinition[] = [
  health,
  prune,
  reconcile,
  retention,
  metaTokenRefresh,
  newsletterSend,
  newsletterPreview,
  marketOpenNotice,
];

export function listSystemJobs(): readonly SystemJobDefinition[] {
  return systemJobs;
}

export function getSystemJob(type: string): SystemJobDefinition | undefined {
  return systemJobs.find((job) => job.type === type);
}
