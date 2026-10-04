import { defaultFlags, flagsSchema, type Flags } from "../../domain/flags.ts";

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
