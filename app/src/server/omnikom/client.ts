import { signBody } from "../lib/hmac.ts";

// The Omnikom webhook adapter (B15 Contract, docs/omnikom-webhook.md): one signed POST and the class of its answer.
// The whole contract is ASSUMED until Omnikom confirms it; another auth scheme changes this file only.

const TIMEOUT_MS = 10_000;
const DETAIL_CHARS = 500;
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

type DeliveryOutcome =
  | { kind: "delivered"; status: number }
  | { kind: "retry"; status?: number; retryAfter?: Date }
  | { kind: "refused"; status: number; detail: string };
type DeliveryKind = DeliveryOutcome["kind"];

/**
 * The answer table (R34): 2xx is accepted and 409 means Omnikom already holds the delivery; 408, 425, 429 and 5xx
 * mean unavailable; every other status refuses the payload and is not retried.
 */
export function classifyStatus(status: number): DeliveryKind {
  if ((status >= 200 && status < 300) || status === 409) return "delivered";
  if (RETRY_STATUSES.has(status) || status >= 500) return "retry";
  return "refused";
}

/** `Retry-After` as seconds or as an HTTP date; undefined when absent or unreadable. */
function retryAfterOf(value: string | null, now: Date): Date | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return new Date(now.getTime() + Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : new Date(at);
}

async function outcomeOf(response: Response, now: Date): Promise<DeliveryOutcome> {
  const { status } = response;
  const kind = classifyStatus(status);
  if (kind === "refused") {
    return { kind, status, detail: (await response.text()).slice(0, DETAIL_CHARS) };
  }
  await response.body?.cancel();
  if (kind === "delivered") return { kind, status };
  const retryAfter = retryAfterOf(response.headers.get("retry-after"), now);
  return retryAfter === undefined ? { kind, status } : { kind, status, retryAfter };
}

/**
 * POSTs the exact body bytes with a fresh timestamp and signature (invariant 2). A retry resends the stored body and
 * the same delivery id. The secret and the signature are never returned or logged (invariant 7).
 */
export async function deliver(
  body: string,
  opts: { deliveryId: string; url: string; secret: string; now: Date },
): Promise<DeliveryOutcome> {
  const timestamp = String(Math.floor(opts.now.getTime() / 1000));
  const headers = {
    "content-type": "application/json",
    "user-agent": "MatterOfPlace-Webhook/1",
    "x-mop-event": "inquiry.received",
    "x-mop-delivery-id": opts.deliveryId,
    "x-mop-timestamp": timestamp,
    "x-mop-signature": await signBody(opts.secret, timestamp, body),
  };
  try {
    const response = await fetch(opts.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return await outcomeOf(response, opts.now);
  } catch {
    // A network error or the 10 second timeout: Omnikom is unavailable, so the step retries.
    return { kind: "retry" };
  }
}
