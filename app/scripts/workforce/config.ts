// The laptop's runtime switches for the AI staff (W5, decided with Jay 2026-10-13): which model Matter uses and
// whether colleagues work their backlog. They live in ~/.mop-workforce/config.json so they change without a pull
// request. An `until` date ends the overrides by itself: after it, the defaults hold again (Opus Matter, backlog on).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CONFIG_FILE = join(homedir(), ".mop-workforce", "config.json");

const DEFAULTS = { matterModel: "claude-opus-5-5", backlog: true } as const;

const configSchema = z.object({
  matterModel: z.string().min(1).optional(),
  backlog: z.boolean().optional(),
  until: z.string().optional(),
});

export interface WorkforceConfig {
  matterModel: string;
  backlog: boolean;
}

/** The switches in force now: the file's while its `until` is ahead (or absent), the defaults otherwise. */
export function workforceConfig(
  file: string = CONFIG_FILE,
  now: Date = new Date(),
): WorkforceConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULTS };
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULTS };
  const until = parsed.data.until === undefined ? null : new Date(parsed.data.until);
  if (until !== null && !(until.getTime() > now.getTime())) return { ...DEFAULTS };
  return {
    matterModel: parsed.data.matterModel ?? DEFAULTS.matterModel,
    backlog: parsed.data.backlog ?? DEFAULTS.backlog,
  };
}
