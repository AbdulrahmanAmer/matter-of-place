import { env } from "../lib/env";
import { logLine } from "../lib/log";
import { sealToken } from "./confirm-email";

/**
 * The sealed form of a confirmation token, which the `subscriber.created` event carries to the mail step (G12), or
 * null when the Worker has no `CONFIRM_TOKEN_SECRET`, so no confirmation mail is sent. It emits and enqueues nothing
 * (G20): `upsert_subscriber` writes the event. The raw token never leaves the request.
 */
export function requestConfirmation(token: string): Promise<string | null> {
  const key = env.CONFIRM_TOKEN_SECRET;
  if (key === undefined) {
    logLine("warn", "confirm_secret_missing");
    return Promise.resolve(null);
  }
  return sealToken(token, key);
}
