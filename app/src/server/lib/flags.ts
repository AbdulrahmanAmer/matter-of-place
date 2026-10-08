import {
  defaultFlags,
  flagsPutSchema,
  flagsSchema,
  type FeatureFlag,
  type Flags,
} from "../../domain/flags.ts";
import { getPublicState, resetPublicStateMemo } from "../public/state.ts";
import { fromRpcError } from "./admin-errors.ts";
import type { AdminActor } from "./admin-route.ts";
import { auditContext } from "./audit.ts";
import { authorize } from "./authz.ts";
import type { Db } from "./db.ts";
import { fromZod } from "./errors.ts";

/**
 * The stored flags with `coming_soon` added from `settings.coming_soon_global`: a missing key reads false, an
 * unknown key is dropped, a row that is not a record of booleans gives the defaults.
 */
export function mergeFlags(flagsRow: unknown, comingSoonGlobal: boolean | null): Flags {
  const parsed = flagsSchema.safeParse(flagsRow);
  return {
    ...defaultFlags,
    ...(parsed.success ? parsed.data : {}),
    coming_soon: comingSoonGlobal === true,
  };
}

/**
 * The one reader of feature flags (GQ-05). It makes no query and keeps no memo: the public state the whole
 * Worker already shares holds the flags, so a flag costs nothing beyond that check.
 */
export async function getFlags(db: Db): Promise<Flags> {
  const state = await getPublicState(db);
  return mergeFlags(state.flags, state.comingSoonGlobal);
}

/**
 * `PUT /api/admin/automation/flags` (invariant 14): one `settings_put_flags` call writes the row and its
 * `automation.flags_put` audit row; a name the request leaves out keeps its value. Other isolates see the change
 * within one state interval; this one drops its memo so its next `getFlags` reads it.
 */
export async function putFlags(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<Record<FeatureFlag, boolean>> {
  authorize(actor, "automation.flags_put");
  const parsed = flagsPutSchema.safeParse(raw);
  if (!parsed.success) throw fromZod(parsed.error);
  const { data, error } = await db.rpc("settings_put_flags", {
    p_value: parsed.data,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  resetPublicStateMemo();
  return { ...defaultFlags, ...flagsSchema.parse(data) };
}
