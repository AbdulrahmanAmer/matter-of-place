import type { SystemJobDefinition } from "../types.ts";

// System jobs (health, prune, reconcile, retention and the rest): each slice appends one import and one entry.
const systemJobs: readonly SystemJobDefinition[] = [];

export function getSystemJob(type: string): SystemJobDefinition | undefined {
  return systemJobs.find((job) => job.type === type);
}
