import { env } from "../lib/env";
import { clientIp, hashKey } from "../lib/ids";
import { logLine } from "../lib/log";

/** The visitor's hashed address: the one value that identifies a request in logs and limits (invariant 4). */
export function ipHashOf(request: Request): Promise<string> {
  return hashKey(env.RATE_LIMIT_SALT, clientIp(request));
}

/** The one `request` line every response writes (invariant 2): ids and numbers only, never a body or an address. */
export function logRequest(fields: {
  requestId: string;
  route: string;
  status: number;
  started: number;
  ipHash: string;
}): void {
  const { started, ...rest } = fields;
  logLine("info", "request", { ...rest, ms: Date.now() - started });
}
