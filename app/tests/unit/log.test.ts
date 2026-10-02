import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
