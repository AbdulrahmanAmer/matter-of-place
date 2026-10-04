import { z } from "zod";
import { logLine } from "./log.ts";

// The Worker environment, parsed once from `process.env` (Nitro's `nodejs_compat` fills it from the
// Worker's vars and secrets). Code the job runner shares reads a variable through `readVar` of
// `runtime-env.ts` instead, because the Edge Function has none of the Worker-only names (G39).

const text = z.string().min(1);

const shape = z.object({
  MOP_ENV: z.enum(["local", "preview", "production"]).default("production"),
  SENTRY_RELEASE: text.default("dev"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: text.optional(),
  TURNSTILE_SECRET: text.optional(),
  RATE_LIMIT_SALT: text,
  SENTRY_DSN: text.optional(),
  MEDIA_PUBLIC_BASE: z.string().url().optional(),
  RESEND_WEBHOOK_SECRET: text.optional(),
  // Path token of the ops-health hook; unset, the hook answers 404 (DO-03).
  OPS_HEALTH_TOKEN: text.optional(),
  // Key of the render callback signature; unset, the render hook answers 503 (B8 Contract).
  RENDER_CALLBACK_SECRET: text.optional(),
  CATALOG_VERSION_TTL_MS: z.coerce.number().int().nonnegative().optional(),
});

// After the launch switch a preview holds no Supabase key (H35 (7)), so only production needs them.
const REQUIRED_IN_PRODUCTION = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const REQUIRED_OUTSIDE_LOCAL = ["TURNSTILE_SECRET", "SENTRY_DSN"] as const;
const OPTIONAL_AND_NOTED = ["MEDIA_PUBLIC_BASE", "RESEND_WEBHOOK_SECRET"] as const;

const schema = shape.superRefine((value, ctx) => {
  const required: readonly (keyof typeof value)[] = [
    ...(value.MOP_ENV === "production" ? REQUIRED_IN_PRODUCTION : []),
    ...(value.MOP_ENV === "local" ? [] : REQUIRED_OUTSIDE_LOCAL),
  ];
  for (const name of required) {
    if (value[name] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: `is required when MOP_ENV is ${value.MOP_ENV}`,
      });
    }
  }
});

/** An empty value counts as unset. Throws an Error naming every missing or invalid variable. */
export function parseEnv(source: Record<string, string | undefined>) {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
    logLine("error", "env_invalid", {
      variables: result.error.issues.map((issue) => issue.path.join(".")).join(","),
    });
    throw new Error(`Invalid environment: ${problems.join("; ")}`);
  }
  for (const name of OPTIONAL_AND_NOTED) {
    if (result.data[name] === undefined) logLine("warn", "env_optional_missing", { name });
  }
  return result.data;
}

export const env = parseEnv(process.env);

/** The options `captureException` takes from its caller; it reads no environment itself (R14, H39 (4)). */
export function sentryOptions() {
  return { dsn: env.SENTRY_DSN, env: env.MOP_ENV, release: env.SENTRY_RELEASE };
}
