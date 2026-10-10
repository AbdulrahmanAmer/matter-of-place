import { channelSettingsSchema, type ApprovalMode } from "../../domain/automation";
import type { Tier } from "../../domain/events";
import type { ChannelPatch, ChannelRow } from "./automation-queries";

// A channel's settings as the person is editing them, and the checks the form can make before the server is asked.
// The server stays the check: `channelPutInput` parses the same schema again.

export interface Draft {
  enabled: boolean;
  days: number[];
  from: string;
  to: string;
  tz: string;
  dailyCap: string;
  approval: Record<Tier, ApprovalMode>;
  autoAfter: string;
}

export type DraftErrors = Partial<
  Record<"days" | "from" | "to" | "dailyCap" | "autoAfter", string>
>;

/** The zones the select offers; a stored zone outside them stays in the list (`zoneOptions`). */
const offeredZones = ["America/Los_Angeles", "America/New_York", "UTC"] as const;

/** ISO weekdays, Monday first. */
export const weekdays = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 7, label: "Sun" },
] as const;

export function draftOf(row: ChannelRow): Draft {
  const { posting_window: window } = row;
  return {
    enabled: row.enabled,
    days: [...window.days],
    from: window.from,
    to: window.to,
    tz: window.tz,
    dailyCap: String(window.daily_cap),
    approval: { ...row.approval_mode },
    autoAfter: row.auto_after ?? "",
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The offered zones, and the stored one first when it is another IANA name, so the select never shows a zone that is not stored. */
export function zoneOptions(stored: string): string[] {
  const offered: string[] = [...offeredZones];
  return offered.includes(stored) ? offered : [stored, ...offered];
}

const errorKeys: Record<string, keyof DraftErrors> = {
  "posting_window.days": "days",
  "posting_window.from": "from",
  "posting_window.to": "to",
  auto_after: "autoAfter",
};

export function patchOf(
  draft: Draft,
): { ok: true; patch: ChannelPatch } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const cap = Number(draft.dailyCap);
  if (draft.dailyCap.trim() === "" || !Number.isInteger(cap) || cap < 1 || cap > 25) {
    errors.dailyCap = "Use a whole number from 1 to 25";
  }
  if (draft.days.length === 0) errors.days = "Choose at least one day";
  const candidate = {
    enabled: draft.enabled,
    posting_window: {
      days: [...draft.days].sort((a, b) => a - b),
      from: draft.from,
      to: draft.to,
      tz: draft.tz,
      daily_cap: cap,
    },
    approval_mode: draft.approval,
    auto_after: draft.autoAfter === "" ? null : draft.autoAfter,
    credentials_ref: null,
  };
  const parsed = channelSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = errorKeys[issue.path.join(".")];
      if (key !== undefined) errors[key] ??= issue.message;
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  const { enabled, posting_window, approval_mode, auto_after } = parsed.data;
  return { ok: true, patch: { enabled, posting_window, approval_mode, auto_after } };
}
