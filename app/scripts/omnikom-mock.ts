// B15 step 5: a stand-in for Omnikom's receiver (docs/omnikom-webhook.md), for dev only. It verifies the signature the
// way a real receiver must and answers the codes the step classifies. The same file runs as a Worker
// (`scripts/omnikom-mock.wrangler.toml`) and, under bun, as a local server: `bun run omnikom:mock [-- --fail <code>]`.
// Its memory (the delivery ids it has seen) lives in the isolate: best effort on the Worker, never a proof.
import { verifyBody } from "../src/server/lib/hmac.ts";

const PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_AGE_SECONDS = 300;
const FAIL_CODES: ReadonlySet<number> = new Set([409, 429, 500]);

interface MockEnv {
  OMNIKOM_WEBHOOK_SECRET?: string | undefined;
}

const seen = new Map<string, string>();

function failCodeOf(value: string | null | undefined): number | undefined {
  const code = Number(value);
  return FAIL_CODES.has(code) ? code : undefined;
}

const answer = (status: number, reason: string, headers?: Record<string, string>): Response =>
  new Response(reason, { status, ...(headers === undefined ? {} : { headers }) });

async function receive(
  request: Request,
  secret: string | undefined,
  forced: number | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("log") === "1") {
    return Response.json(
      [...seen].map(([delivery_id, received_at]) => ({ delivery_id, received_at })),
    );
  }
  if (secret === undefined || secret === "") return answer(500, "mock_secret_missing");

  const raw = await request.text();
  const timestamp = request.headers.get("x-mop-timestamp") ?? "";
  const signature = request.headers.get("x-mop-signature") ?? "";
  const fresh =
    /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= MAX_AGE_SECONDS;
  if (!fresh || !(await verifyBody(secret, timestamp, raw, signature))) {
    return answer(401, "bad_signature");
  }
  if (request.method !== "POST") return answer(405, "method_not_allowed");
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return answer(413, "body_too_large");
  const deliveryId = request.headers.get("x-mop-delivery-id");
  if (deliveryId === null || deliveryId === "") return answer(400, "delivery_id_missing");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return answer(400, "invalid_json");
  }

  const fail = forced ?? failCodeOf(url.searchParams.get("fail"));
  if (fail !== undefined) {
    return answer(fail, "forced", fail === 429 ? { "retry-after": "30" } : undefined);
  }
  if (seen.has(deliveryId)) return answer(409, "already_received");
  seen.set(deliveryId, new Date().toISOString());
  console.log(`signature ok, delivery ${deliveryId}`);
  console.log(JSON.stringify(payload, null, 2));
  return answer(200, "accepted");
}

const worker = {
  fetch: (request: Request, env: MockEnv): Promise<Response> =>
    receive(request, env.OMNIKOM_WEBHOOK_SECRET, undefined),
};
// Bun serves any entry file whose default export has `fetch` on port 3000, next to the Bun.serve below.
export default typeof Bun === "undefined" ? worker : {};

if (typeof Bun !== "undefined" && import.meta.main) {
  const secret = process.env["OMNIKOM_MOCK_SECRET"];
  if (secret === undefined || secret === "") {
    throw new Error("omnikom-mock: OMNIKOM_MOCK_SECRET is not set (load the dev profile)");
  }
  const flag = process.argv.indexOf("--fail");
  const forced = flag === -1 ? undefined : failCodeOf(process.argv[flag + 1]);
  if (flag !== -1 && forced === undefined) {
    throw new Error(`omnikom-mock: --fail takes one of ${[...FAIL_CODES].join(", ")}`);
  }
  Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    fetch: (request) => receive(request, secret, forced),
  });
  console.log(
    `omnikom-mock listening on http://127.0.0.1:${String(PORT)}${forced === undefined ? "" : `, answering ${String(forced)}`}`,
  );
}
