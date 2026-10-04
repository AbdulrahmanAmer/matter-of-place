import { z } from "zod";
import { timingSafeEqual } from "../lib/crypto";
import type { Db } from "../lib/db";
import type { env as serverEnv } from "../lib/env";
import { logLine } from "../lib/log";

const healthSchema = z.object({ ok: z.boolean(), failing: z.array(z.string()) });

const bytes = (text: string) => new TextEncoder().encode(text);

// Plain text on purpose: the uptime monitor matches the keyword `ok` (R09 exception, ruling H40).
function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * `GET /api/hooks/ops-health/<token>` (DO-03, JOB-04). A wrong token or an unset secret answers 404 and makes no
 * RPC; otherwise one `ops_health` RPC answers 200 `ok` or 503 `fail: <names>`. The client is taken only after the
 * token matched, so a Worker without a database key answers 503 `fail: ops_health_rpc` to the right token.
 */
export async function handleOpsHealth(
  db: () => Db,
  token: string,
  env: Pick<typeof serverEnv, "OPS_HEALTH_TOKEN">,
): Promise<Response> {
  const secret = env.OPS_HEALTH_TOKEN;
  if (secret === undefined || !timingSafeEqual(bytes(token), bytes(secret))) {
    return plain(404, "not found");
  }
  let message: string;
  try {
    const { data, error } = await db().rpc("ops_health", { p_now: new Date().toISOString() });
    const health = healthSchema.safeParse(data);
    if (error === null && health.success) {
      return health.data.ok
        ? plain(200, "ok")
        : plain(503, `fail: ${health.data.failing.join(",")}`);
    }
    message = error?.message ?? "unexpected ops_health answer";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  logLine("error", "ops_health_failed", { message });
  return plain(503, "fail: ops_health_rpc");
}
