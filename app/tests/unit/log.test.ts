import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as Routes from "../../src/server/public/routes";
import type { PublicRoute } from "../../src/server/public/routes";
import { catalogDb } from "../fixtures/snapshot";
import { LogEvent } from "../../src/server/lib/log-events";
import { logLine, maskEmails } from "../../src/server/lib/log";

const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const METHODS = ["log", "warn", "error"] as const;

const written: { method: (typeof METHODS)[number]; line: string }[] = [];

const parsed = (line: string) => z.record(z.string(), z.unknown()).parse(JSON.parse(line));

beforeEach(() => {
  written.length = 0;
  for (const method of METHODS) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      written.push({ method, line: String(line) });
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logLine", () => {
  it("writes one JSON line with level, event and the fields", () => {
    logLine("info", "unhandled_error", { requestId: "r-1", status: 500, retry: false, none: null });
    expect(written).toHaveLength(1);
    expect(parsed(written[0]?.line ?? "")).toEqual({
      level: "info",
      event: "unhandled_error",
      requestId: "r-1",
      status: 500,
      retry: false,
      none: null,
    });
  });

  it("only ever emits an event that is a member of LogEvent", () => {
    for (const event of LogEvent) logLine("warn", event);
    expect(written.map(({ line }) => parsed(line)["event"])).toEqual([...LogEvent]);
  });

  it("masks an email in a field and emits no email-shaped string", () => {
    logLine("error", "unhandled_error", {
      requestId: "r-2",
      route: "/contact/x@y.com",
      message: "failed for a.b+tag@mail.example.co.uk and then c@d.org",
    });
    const fields = parsed(written[0]?.line ?? "");
    expect(fields["route"]).toBe("/contact/[email]");
    expect(fields["message"]).toBe("failed for [email] and then [email]");
    for (const { line } of written) expect(line).not.toMatch(EMAIL_SHAPED);
  });

  it("sends each level to its console method", () => {
    logLine("error", "unhandled_error");
    logLine("warn", "unhandled_error");
    logLine("info", "unhandled_error");
    expect(written.map(({ method }) => method)).toEqual(["error", "warn", "log"]);
  });
});

describe("maskEmails", () => {
  it("replaces every email-shaped substring and keeps the rest", () => {
    expect(maskEmails("x@y.com")).toBe("[email]");
    expect(maskEmails("write to a@b.co or c.d@e.io now")).toBe("write to [email] or [email] now");
    expect(maskEmails("no address here, just 12@3")).toBe("no address here, just 12@3");
  });

  it("finishes at once on a long token with no address", () => {
    const started = performance.now();
    maskEmails("a".repeat(200_000));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("handlePublic (B3 invariant 2)", () => {
  it("emits exactly one request line with the five fields, and no address in any line", async () => {
    vi.resetModules();
    vi.doMock("../../src/server/public/routes", async (importOriginal) => {
      const original = await importOriginal<typeof Routes>();
      const echo: PublicRoute = {
        path: "/api/public/echo",
        method: "POST",
        schema: z.object({ email: z.string() }),
        limits: [],
        turnstile: false,
        status: 201,
        service: () => Promise.resolve({ ok: true }),
      };
      return { ...original, routes: [...original.routes, echo] };
    });
    const { handlePublic } = await import("../../src/server/public/pipeline");
    written.length = 0; // importing env.ts warns about the optional names it lacks
    const rawIp = "203.0.113.99";
    const request = new Request("https://matterofplace.com/api/public/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": rawIp },
      body: JSON.stringify({ email: "x@y.com" }),
    });
    const response = await handlePublic(request, "req-12345678", catalogDb());
    expect(response.status).toBe(201);
    expect(written).toHaveLength(1);
    const line = parsed(written[0]?.line ?? "");
    expect(Object.keys(line).sort()).toEqual(
      ["event", "ipHash", "level", "ms", "requestId", "route", "status"].sort(),
    );
    expect(line).toMatchObject({
      level: "info",
      event: "request",
      requestId: "req-12345678",
      route: "/api/public/echo",
      status: 201,
    });
    expect(LogEvent).toContain(line["event"]);
    for (const { line: text } of written) {
      expect(text).not.toMatch(EMAIL_SHAPED);
      expect(text).not.toContain(rawIp);
    }
  });
});
