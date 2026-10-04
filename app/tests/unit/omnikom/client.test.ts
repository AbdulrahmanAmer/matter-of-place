import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { classifyStatus, deliver } from "../../../src/server/omnikom/client";
import { nextRetryAt } from "../../../src/server/omnikom/ladder";

const vector = z
  .object({ secret: z.string(), timestamp: z.string(), body: z.string(), expected: z.string() })
  .parse(JSON.parse(readFileSync(new URL("vector.json", import.meta.url), "utf8")));
const URL_OMNIKOM = "https://omnikom.test/hooks/mop";
const DELIVERY_ID = "73b49cbb-58d6-5523-ac41-4f6669fef9d5";
const VECTOR_NOW = new Date(Number(vector.timestamp) * 1000);

type Sent = { url: string; init: RequestInit };

/** A fake Omnikom endpoint: records each request and answers with `answer()`. */
function fakeOmnikom(answer: () => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return answer();
  });
  return sent;
}

const send = (now = VECTOR_NOW) =>
  deliver(vector.body, { deliveryId: DELIVERY_ID, url: URL_OMNIKOM, secret: vector.secret, now });
const headerOf = (sent: Sent | undefined, name: string) =>
  new Headers(sent?.init.headers).get(name);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deliver", () => {
  it("invariant 2: signs the timestamp and the raw body exactly as the shared vector", async () => {
    const sent = fakeOmnikom(() => new Response(null, { status: 202 }));
    await send();
    expect(headerOf(sent[0], "x-mop-timestamp")).toBe(vector.timestamp);
    expect(headerOf(sent[0], "x-mop-signature")).toBe(vector.expected);
    expect(sent[0]?.init.body).toBe(vector.body);
  });

  it("sends the contract headers to the endpoint with a timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const sent = fakeOmnikom(() => new Response(null, { status: 200 }));
    await send();
    expect(sent[0]?.url).toBe(URL_OMNIKOM);
    expect(sent[0]?.init.method).toBe("POST");
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(sent[0]?.init.signal).toBe(timeout.mock.results[0]?.value);
    expect({
      type: headerOf(sent[0], "content-type"),
      agent: headerOf(sent[0], "user-agent"),
      event: headerOf(sent[0], "x-mop-event"),
      id: headerOf(sent[0], "x-mop-delivery-id"),
    }).toEqual({
      type: "application/json",
      agent: "MatterOfPlace-Webhook/1",
      event: "inquiry.received",
      id: DELIVERY_ID,
    });
  });

  it("invariant 2: a retry resends the same bytes and delivery id with a new timestamp and signature", async () => {
    const sent = fakeOmnikom(() => new Response(null, { status: 503 }));
    await send();
    await send(new Date(VECTOR_NOW.getTime() + 60_000));
    expect(sent[1]?.init.body).toBe(sent[0]?.init.body);
    expect(headerOf(sent[1], "x-mop-delivery-id")).toBe(DELIVERY_ID);
    expect(headerOf(sent[1], "x-mop-timestamp")).toBe(String(Number(vector.timestamp) + 60));
    expect(headerOf(sent[1], "x-mop-signature")).not.toBe(vector.expected);
  });

  it("counts 200, 202 and 409 as delivered", async () => {
    const outcomes = [];
    for (const status of [200, 202, 409]) {
      fakeOmnikom(() => new Response(null, { status }));
      outcomes.push(await send());
    }
    expect(outcomes).toEqual([
      { kind: "delivered", status: 200 },
      { kind: "delivered", status: 202 },
      { kind: "delivered", status: 409 },
    ]);
  });

  it("invariant 3b: refuses a 422 and keeps the first 500 characters of the answer", async () => {
    fakeOmnikom(() => new Response("x".repeat(800), { status: 422 }));
    expect(await send()).toEqual({ kind: "refused", status: 422, detail: "x".repeat(500) });
  });

  it("invariant 3b: stops reading a refused answer after 500 characters", async () => {
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("y".repeat(600)));
      },
    });
    fakeOmnikom(() => new Response(endless, { status: 400 }));
    expect(await send()).toEqual({ kind: "refused", status: 400, detail: "y".repeat(500) });
  });

  it("invariant 3: a 429 with Retry-After: 120 schedules the next attempt at least 120 seconds later", async () => {
    fakeOmnikom(() => new Response(null, { status: 429, headers: { "retry-after": "120" } }));
    const outcome = await send();
    expect(outcome.kind).toBe("retry");
    const at = nextRetryAt(1, VECTOR_NOW, "retryAfter" in outcome ? outcome.retryAfter : undefined);
    expect(at?.getTime()).toBeGreaterThanOrEqual(VECTOR_NOW.getTime() + 120_000);
  });

  it("invariant 3: retries on 408, 425, 500, 503 and a network error", async () => {
    const kinds = [];
    for (const status of [408, 425, 500, 503]) {
      fakeOmnikom(() => new Response(null, { status }));
      kinds.push((await send()).kind);
    }
    fakeOmnikom(() => Promise.reject(new TypeError("fetch failed")));
    kinds.push((await send()).kind);
    expect(kinds).toEqual(["retry", "retry", "retry", "retry", "retry"]);
  });
});

describe("classifyStatus", () => {
  it("invariant 3b: refuses every other status, a redirect included, and retries none of them", () => {
    const refused = [301, 302, 400, 401, 403, 404, 410, 413, 422];
    expect(refused.map(classifyStatus)).toEqual(refused.map(() => "refused"));
  });
});
