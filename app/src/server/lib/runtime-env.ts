// The one way code shared with the job runner reads a variable (R14, G39): `env.ts` throws on
// Worker-only names that the Edge Function does not have. Read at call time, never at import.

interface Runtime {
  process?: { env?: Record<string, string | undefined> };
  Deno?: { env: { get: (name: string) => string | undefined } };
}

const runtime: Runtime = globalThis;

export function readVar(name: string): string | undefined {
  return runtime.process?.env?.[name] ?? runtime.Deno?.env.get(name);
}

const FLAGS = {
  email: { dryRun: "EMAIL_DRY_RUN", live: "EMAIL_LIVE" },
  social: { dryRun: "SOCIAL_DRY_RUN", live: "SOCIAL_LIVE" },
} as const;

/**
 * The one question every outside sender asks before a real call (R35, E2E-04). A dry-run flag
 * always wins; otherwise only production, or the channel's own live flag, says yes. An unset
 * `MOP_ENV` is not production here, so a dev run fails closed.
 */
export function liveSideEffects(channel: "email" | "social"): boolean {
  const flags = FLAGS[channel];
  if (readVar(flags.dryRun) === "1") return false;
  return readVar("MOP_ENV") === "production" || readVar(flags.live) === "1";
}
