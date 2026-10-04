import { z } from "zod";

// Cloudflare Turnstile's siteverify, the one outside call of the public pipeline (invariant 6). It has three
// outcomes (GD-05): `fail` is a refusal, `unreachable` accepts the write and flags the row. It never throws.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 2000;
// Cloudflare's published test secrets (always pass, always fail, token already spent). Their answers carry
// no real hostname, so previews and the tests could never pass the host and action checks.
const TEST_SECRET = /^[123]x0+AA$/;
const PREVIEW_HOST = /^pr-\d+\.holy-meadow-4327\.workers\.dev$/;
const HOSTS: Readonly<Record<string, readonly string[]>> = {
  production: [
    "matterofplace.com",
    "www.matterofplace.com",
    "matter-of-place.holy-meadow-4327.workers.dev",
  ],
  preview: ["matter-of-place-dev.holy-meadow-4327.workers.dev"],
};

export type TurnstileOutcome = "pass" | "fail" | "unreachable";

export interface TurnstileEnv {
  MOP_ENV: string;
  TURNSTILE_SECRET?: string | undefined;
}

const answerSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

/** Whether a siteverify `hostname` is one this environment serves (INT-02 (5)); a local run serves any host. */
export function turnstileHostAllowed(hostname: string, mopEnv: string): boolean {
  if (mopEnv === "local") return true;
  if (HOSTS[mopEnv]?.includes(hostname) === true) return true;
  return mopEnv === "preview" && PREVIEW_HOST.test(hostname);
}

/**
 * `token` is the `x-turnstile-token` header, `action` the route's bucket name (G72), which the browser passed to
 * `getTurnstileToken`. A missing secret answers first (`local` only, so a local row is honestly flagged), then an
 * absent token without calling Cloudflare.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string,
  env: TurnstileEnv,
  action: string,
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET;
  if (secret === undefined || secret === "") return "unreachable";
  if (token === null || token === undefined || token === "") return "fail";
  let answer: z.infer<typeof answerSchema>;
  try {
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 500) return "unreachable";
    answer = answerSchema.parse(await response.json());
  } catch {
    return "unreachable";
  }
  if (!answer.success) return "fail";
  if (TEST_SECRET.test(secret)) return "pass";
  const allowed =
    answer.hostname !== undefined && turnstileHostAllowed(answer.hostname, env.MOP_ENV);
  return allowed && answer.action === action ? "pass" : "fail";
}
