import type { SystemJobDefinition } from "../types.ts";
import { copySubmissionMedia } from "./copy-submission-media.ts";
import { health } from "./health.ts";
import { invoicePdf } from "./invoice-pdf.ts";
import { metaTokenRefresh } from "./meta-token-refresh.ts";
import { prune } from "./prune.ts";
import { reconcile } from "./reconcile.ts";
import { retention } from "./retention.ts";
import { takedownMedia } from "./takedown-media.ts";

// System jobs (health, prune, reconcile, retention and the rest): each slice appends one import and one entry. They
// are runnable but never selectable in a recipe.
const systemJobs: readonly SystemJobDefinition[] = [
  health,
  prune,
  reconcile,
  retention,
  metaTokenRefresh,
  invoicePdf,
  copySubmissionMedia,
  takedownMedia,
];

export function listSystemJobs(): readonly SystemJobDefinition[] {
  return systemJobs;
}

export function getSystemJob(type: string): SystemJobDefinition | undefined {
  return systemJobs.find((job) => job.type === type);
}
