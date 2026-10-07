import { z } from "zod";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { readVar } from "../lib/runtime-env.ts";

// The Meta token and its health (B10 Contract, INT-06). Both read what B8's `meta_token_refresh` stored: the token
// in Vault and the check's result in `settings.meta`. Nothing here calls Graph, so the posts, the reconcile job and
// the daily check cannot disagree about the token.

export { META_REQUIRED_SCOPES } from "../jobs/system/meta-token-refresh.ts";

/** The page token: the Vault secret `meta_page_token` once B8's refresh job has written one, else `META_PAGE_TOKEN`. */
export async function getMetaToken(db: Db): Promise<string> {
  const { data, error } = await db.rpc("get_vault_secret", { p_name: "meta_page_token" });
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The job system did not answer (get_vault_secret).",
    );
  }
  const token = data || readVar("META_PAGE_TOKEN");
  if (token === undefined || token === "") {
    throw new AppError("server", undefined, "No Meta page token is stored.");
  }
  return token;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AMBER_DAYS = 14;
const RED_DAYS = 7;

const settingsMetaSchema = z
  .object({
    token_expires_at: z.string().nullable().optional(),
    token_state: z.string().optional(),
    data_access_expires_at: z.string().nullable().optional(),
  })
  .passthrough();

type Level = "ok" | "amber" | "red";

const daysUntil = (iso: string, now: Date) =>
  Math.floor((new Date(iso).getTime() - now.getTime()) / DAY_MS);

/**
 * The health of the stored token (GS-01, INT-06): red for any `token_state` other than `ok` or 7 days or fewer
 * left, amber for 14 days or fewer left or a data access expiry within 14 days. A null expiry never expires.
 */
export function tokenHealth(
  settingsMeta: unknown,
  now: Date,
): { expiresAt: string; daysLeft: number | null; level: Level } {
  const meta = settingsMetaSchema.safeParse(settingsMeta).data;
  const expiresAt = meta?.token_expires_at ?? null;
  const daysLeft = expiresAt === null ? null : daysUntil(expiresAt, now);
  const dataAccess = meta?.data_access_expires_at ?? null;
  const dataAccessDays = dataAccess === null ? null : daysUntil(dataAccess, now);
  let level: Level = "ok";
  if (meta?.token_state !== "ok" || (daysLeft !== null && daysLeft <= RED_DAYS)) level = "red";
  else if (
    (daysLeft !== null && daysLeft <= AMBER_DAYS) ||
    (dataAccessDays !== null && dataAccessDays <= AMBER_DAYS)
  ) {
    level = "amber";
  }
  return { expiresAt: expiresAt ?? "never", daysLeft, level };
}
