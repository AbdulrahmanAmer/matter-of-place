import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { properties } from "../../src/data/properties";
import { pickCard } from "../../src/lib/property-card";
import { getTurnstileToken } from "../../src/lib/turnstile";
import { inquirySchema, submissionSchema } from "../../src/domain/contracts";
import { createApiClient, HttpServiceError, type FetchImpl } from "../../src/services/http/client";
import { createHttpServices } from "../../src/services/http";
import { ServiceError } from "../../src/services/types";
import { validInquiry, validSubmission, validSubscriber } from "../fixtures/builders";

vi.mock("../../src/lib/turnstile", () => ({ getTurnstileToken: vi.fn() }));

const RECEIPT = { id: "r1", receivedAt: "2026-10-04T00:00:00Z" };

const Init = z.object({
  method: z.string(),
  headers: z.instanceof(Headers),
  body: z.string().optional(),
});

let reply: () => Response;
const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(reply()));

function sent(index = 0) {
  const call = fetchImpl.mock.calls[index];
  if (!call) throw new Error(`no call number ${String(index)}`);
  const init = Init.parse(call[1]);
  return {
    url: call[0],
    method: init.method,
    headers: init.headers,
    body: z.record(z.string(), z.unknown()).parse(JSON.parse(init.body ?? "{}")),
  };
}

beforeEach(() => {
  reply = () => Response.json({ ...RECEIPT, uploads: [] });
  fetchImpl.mockClear();
  vi.mocked(getTurnstileToken).mockReset();
  vi.mocked(getTurnstileToken).mockResolvedValue("tok");
});

describe("the three form writes", () => {
  const services = () => createHttpServices("/api/public", fetchImpl);

  it("send the Turnstile token of their own action and a website field", async () => {
    const { inquiries, submissions, newsletter } = services();
    await inquiries.send(inquirySchema.parse(validInquiry()));
    await submissions.send(submissionSchema.parse(validSubmission()), []);
    await newsletter.subscribe(validSubscriber());
    expect(vi.mocked(getTurnstileToken).mock.calls).toEqual([
      ["inquiries"],
      ["submissions"],
      ["subscribers"],
    ]);
    for (const [index, path] of ["/inquiries", "/submissions", "/subscribers"].entries()) {
      const call = sent(index);
      expect(call.url).toBe(`/api/public${path}`);
      expect(call.method).toBe("POST");
      expect(call.headers.get("x-turnstile-token")).toBe("tok");
      expect(call.headers.get("content-type")).toBe("application/json");
      expect(call.body["website"]).toBe("");
    }
  });

  it("send no token header when the browser has none, and still post", async () => {
    vi.mocked(getTurnstileToken).mockResolvedValue(null);
    await services().newsletter.subscribe(validSubscriber());
    expect(sent().headers.has("x-turnstile-token")).toBe(false);
  });

  it("carry a filled honeypot through to the Worker", async () => {
    const filled = { ...inquirySchema.parse(validInquiry()), website: "https://spam.invalid" };
    await services().inquiries.send(filled);
    expect(sent().body["website"]).toBe("https://spam.invalid");
  });

  it("send a read with no Turnstile call", async () => {
    reply = () => Response.json([]);
    await services().catalog.listMarkets();
    expect(getTurnstileToken).not.toHaveBeenCalled();
    expect(sent().headers.has("x-turnstile-token")).toBe(false);
  });
});

describe("the property list", () => {
  it("keeps the card fields and the card rendition and drops everything else", async () => {
    const first = properties[0];
    if (first === undefined) throw new Error("no bundled property");
    const rendition = { w: 720, h: 540, webp: "/media/v/o/1-aaaaaaaa/card.webp" };
    reply = () =>
      Response.json([
        { ...first, heroVariants: { card: rendition, hero: { ...rendition, w: 1600 } } },
      ]);
    const [card] = await createHttpServices("/api/public", fetchImpl).catalog.listProperties();
    expect(card).toEqual({ ...pickCard(first), heroVariants: { card: rendition } });
    expect(Object.keys(card ?? {})).not.toContain("gallery");
  });
});

describe("a failed call", () => {
  const failing = (init: ResponseInit, body?: string) => {
    reply = () => new Response(body ?? null, init);
    return createApiClient("/api", fetchImpl).get("/x", z.unknown());
  };

  it("takes the request id from the x-request-id header", async () => {
    const error = await failing(
      { status: 500, statusText: "Server Error", headers: { "x-request-id": "r1" } },
      JSON.stringify({ error: { code: "server", requestId: "r2" } }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpServiceError);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      kind: "server",
      message: "Server Error",
      status: 500,
      requestId: "r1",
    });
  });

  it("falls back to the request id in the error body", async () => {
    const error = await failing(
      { status: 500 },
      JSON.stringify({ error: { code: "server", requestId: "r3" } }),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "server", status: 500, requestId: "r3" });
  });

  it("has no request id when the body is not JSON or names none", async () => {
    const html = await failing({ status: 502 }, "<html>bad gateway</html>").catch(
      (caught: unknown) => caught,
    );
    const bare = await failing(
      { status: 422 },
      JSON.stringify({ error: { code: "validation" } }),
    ).catch((caught: unknown) => caught);
    expect(html).toBeInstanceOf(HttpServiceError);
    expect(html).toMatchObject({ kind: "server", status: 502 });
    expect(bare).toMatchObject({ kind: "validation", status: 422 });
    expect(
      [html, bare].map((error) => error instanceof HttpServiceError && error.requestId),
    ).toEqual([undefined, undefined]);
  });
});
