// The laptop's staff policy (W6 item 1): the runner sets it each pass from the weekly Claude allowance
// (usage-policy.ts) and keeps it in ~/.mop-workforce/policy.json. ~/.mop-workforce/config.json is the operator's
// override, not the switch: each field it names wins while its `until` is ahead (or absent); after it, the allowance
// decides again.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  policyChanged,
  policyFor,
  policySchema,
  readingOf,
  type Override,
  type Reading,
  type StaffPolicy,
} from "./usage-policy.ts";

export const CONFIG_FILE = join(homedir(), ".mop-workforce", "config.json");
export const POLICY_FILE = join(homedir(), ".mop-workforce", "policy.json");
export const USAGE_FILE = join(homedir(), ".claude", "usage.json");

const configSchema = z.object({
  matterModel: z.string().min(1).optional(),
  // W5's switch was a boolean; it still reads as "all" or "off".
  backlog: z.union([z.boolean(), z.enum(["all", "person", "off"])]).optional(),
  // The operator's order of 2026-10-16 ("just remove the allowance thing"): "ignore" sets the week's percentage aside.
  allowance: z.enum(["ignore", "follow"]).optional(),
  until: z.string().optional(),
});

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The operator's override in force now: the file's fields while its `until` is ahead (or absent), none after it. */
export function workforceOverride(file: string = CONFIG_FILE, now: Date = new Date()): Override {
  const parsed = configSchema.safeParse(readJson(file));
  if (!parsed.success) return {};
  const until = parsed.data.until === undefined ? null : new Date(parsed.data.until);
  if (until !== null && !(until.getTime() > now.getTime())) return {};
  const { matterModel, backlog, allowance } = parsed.data;
  return {
    ...(allowance === "ignore" ? { allowance } : {}),
    ...(matterModel === undefined ? {} : { matterModel }),
    ...(backlog === undefined
      ? {}
      : { backlog: typeof backlog === "boolean" ? (backlog ? "all" : "off") : backlog }),
  };
}

/**
 * The Google Drive Social Media folder on this laptop (`driveSocial` in config.json, read whatever its `until`), or null
 * when it names none: a toolkit that writes there is then refused (ruling H115, review of 2026-10-16).
 */
export function driveSocialFolder(file: string = CONFIG_FILE): string | null {
  const parsed = z.object({ driveSocial: z.string().min(3) }).safeParse(readJson(file));
  return parsed.success ? parsed.data.driveSocial : null;
}

/** The policy the last pass wrote, or null before the first. */
export function lastPolicy(file: string = POLICY_FILE): StaffPolicy | null {
  const parsed = policySchema.safeParse(readJson(file));
  return parsed.success ? parsed.data : null;
}

/** The policy in force: the last pass's, or the unmeasured middle tier before the first (never full power). */
export function staffPolicy(file: string = POLICY_FILE): StaffPolicy {
  return lastPolicy(file) ?? policyFor(null, {}, null);
}

export interface PolicyFiles {
  usage: string;
  config: string;
  policy: string;
}

const FILES: PolicyFiles = { usage: USAGE_FILE, config: CONFIG_FILE, policy: POLICY_FILE };

/**
 * One pass: reads the allowance and the override, writes the policy, and says whether what the staff may do changed
 * (the caller tells the team), with the week's reading, or null when it was unreadable (the caller logs
 * `usage: unreadable`; otherwise it records the reading for the Office).
 */
export function refreshPolicy(
  files: PolicyFiles = FILES,
  now: Date = new Date(),
): { policy: StaffPolicy; changed: boolean; reading: Reading | null } {
  const reading = readingOf(readJson(files.usage), now);
  const last = lastPolicy(files.policy);
  const policy = policyFor(reading, workforceOverride(files.config, now), last);
  writeFileSync(files.policy, `${JSON.stringify(policy, null, 2)}\n`);
  return { policy, changed: policyChanged(last, policy), reading };
}
