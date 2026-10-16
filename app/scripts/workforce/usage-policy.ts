// W6 item 1 (operator, 2026-10-13: "a built-in way for the employees to see how much weekly usage is available ... so I
// don't have to do that manually"): the staff policy follows the weekly Claude allowance of the account signed in on this
// laptop. Pure: the status line's reading in, the policy out; config.ts reads and writes the files.
import { z } from "zod";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";

/** Self-started work: "all" (colleagues' backlog and Matter's goal), "person" (only what a person set, Matter's goal), "off". */
export type Backlog = "all" | "person" | "off";

export interface StaffPolicy {
  matterModel: string;
  backlog: Backlog;
  /** Only a person's own line is answered; events and colleagues' mentions wait. */
  personOnly: boolean;
  /** The strongest model a colleague may run on. */
  colleagueCeiling: "opus" | "sonnet";
  reason: string;
  week: number | null;
}

export interface Reading {
  weekPercent: number;
  resetsAt: Date;
}

/** An operator override from ~/.mop-workforce/config.json; each field it names wins over the allowance. */
export interface Override {
  matterModel?: string;
  backlog?: Backlog;
  /** "ignore": the week's percentage sets nothing (the operator's order of 2026-10-16: no allowance stop while overdrive runs). */
  allowance?: "ignore";
}

const usageWindow = z.object({
  used_percentage: z.number().nullable().optional(),
  resets_at: z.number().nullable().optional(),
});
const usageFile = z.object({ updated: z.string(), seven_day: usageWindow.optional() });

/** A reading older than this may hide what the runner itself spent since; the last policy holds instead. */
export const STALE_MS = 12 * 60 * 60_000;

/**
 * The week's reading from ~/.claude/usage.json (written by the status line of a running session), or null when it is
 * missing, malformed, older than STALE_MS, or from a week that has already reset.
 */
export function readingOf(raw: unknown, now: Date): Reading | null {
  const parsed = usageFile.safeParse(raw);
  if (!parsed.success) return null;
  const week = parsed.data.seven_day;
  const percent = week?.used_percentage;
  const reset = week?.resets_at;
  if (percent === null || percent === undefined || reset === null || reset === undefined)
    return null;
  const updated = new Date(parsed.data.updated).getTime();
  if (Number.isNaN(updated) || now.getTime() - updated > STALE_MS) return null;
  const resetsAt = new Date(reset * 1000);
  if (!(resetsAt.getTime() > now.getTime())) return null;
  return { weekPercent: Math.round(percent), resetsAt };
}

/** The tier the week sits in: under 70% full staff; 70 to 90% Sonnet and a person's work only; over 90% only a person's lines. */
function tier(week: number): Omit<StaffPolicy, "week"> {
  if (week < 70) {
    return {
      matterModel: OPUS,
      backlog: "all",
      personOnly: false,
      colleagueCeiling: "opus",
      reason: `Weekly allowance at ${String(week)}%: full staff, Opus for Matter, backlog on.`,
    };
  }
  if (week <= 90) {
    return {
      matterModel: SONNET,
      backlog: "person",
      personOnly: false,
      colleagueCeiling: "sonnet",
      reason: `Weekly allowance at ${String(week)}%: Sonnet for everyone, backlog only for work a person started.`,
    };
  }
  return {
    matterModel: SONNET,
    backlog: "off",
    personOnly: true,
    colleagueCeiling: "sonnet",
    reason: `Weekly allowance at ${String(week)}%: backlog paused, only a person's lines are answered.`,
  };
}

/** Without a reading and without a last policy: the middle tier, never full power. */
const UNMEASURED: StaffPolicy = {
  ...tier(70),
  reason: "Allowance not measured yet: Sonnet, a person's work only.",
  week: null,
};

/**
 * The policy for a reading. An unreadable reading keeps the last policy (or the middle tier when there is none), never
 * full power; an override's fields win either way.
 */
export function policyFor(
  reading: Reading | null,
  override: Override,
  last: StaffPolicy | null,
): StaffPolicy {
  const base: StaffPolicy =
    override.allowance === "ignore"
      ? {
          ...tier(0),
          week: reading?.weekPercent ?? last?.week ?? null,
          reason: `Weekly allowance${reading === null ? "" : ` at ${String(reading.weekPercent)}%`} set aside by the operator's order: full staff, Opus for Matter, backlog on.`,
        }
      : reading === null
        ? (last ?? UNMEASURED)
        : { ...tier(reading.weekPercent), week: reading.weekPercent };
  return {
    ...base,
    ...(override.matterModel === undefined ? {} : { matterModel: override.matterModel }),
    ...(override.backlog === undefined ? {} : { backlog: override.backlog }),
  };
}

/** Whether two policies differ in what the staff may do (the reason and the percentage alone are not a change). */
export function policyChanged(last: StaffPolicy | null, next: StaffPolicy): boolean {
  return (
    last === null ||
    last.matterModel !== next.matterModel ||
    last.backlog !== next.backlog ||
    last.personOnly !== next.personOnly ||
    last.colleagueCeiling !== next.colleagueCeiling
  );
}

/** A colleague's model alias held to the ceiling: "opus" becomes "sonnet" while the ceiling is Sonnet. */
export function underCeiling(alias: string, ceiling: StaffPolicy["colleagueCeiling"]): string {
  return ceiling === "sonnet" && alias === "opus" ? "sonnet" : alias;
}

export const policySchema = z.object({
  matterModel: z.string().min(1),
  backlog: z.enum(["all", "person", "off"]),
  personOnly: z.boolean(),
  colleagueCeiling: z.enum(["opus", "sonnet"]),
  reason: z.string(),
  week: z.number().nullable(),
});
