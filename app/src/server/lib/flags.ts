import { defaultFlags, flagsSchema, type Flags } from "../../domain/flags.ts";
import { getPublicState } from "../public/state.ts";
import type { Db } from "./db.ts";

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
