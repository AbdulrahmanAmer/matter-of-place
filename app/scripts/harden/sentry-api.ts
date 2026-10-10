// The read side of Sentry for H1's observability probes (`sentry-probe.ts`, `health-drill.ts`): one GET of the project's
// API with the read-only user token `SENTRY_AUTH_TOKEN` (the `mop-readonly` token of G11, decision S59, ASSUMED E21).
import type { ZodType } from "zod";
import { readSecret } from "../lib/social-script.ts";

const PROJECT = "javascript-tanstackstart-react";
const TIMEOUT_MS = 30_000;

/** The token, or undefined when this shell and the local `.env` hold none: the caller then prints `BLOCKED`. */
export function sentryToken(): string | undefined {
  return readSecret("SENTRY_AUTH_TOKEN");
}

/** `GET https://sentry.io/api/0/projects/<org>/<project>/<path>`, parsed by `schema`. */
export async function sentryGet<T>(token: string, path: string, schema: ZodType<T>): Promise<T> {
  const org = readSecret("SENTRY_ORG") ?? "matter-of-place";
  const response = await fetch(`https://sentry.io/api/0/projects/${org}/${PROJECT}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`sentry: ${path} answered ${String(response.status)}`);
  return schema.parse(await response.json());
}
