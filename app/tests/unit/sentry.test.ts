import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CaptureOptions, SentryEvent } from "../../src/server/lib/sentry";

const DSN = "https://publickey123@o42.ingest.us.sentry.io/4507";
const ENVELOPE_URL = "https://o42.ingest.us.sentry.io/api/4507/envelope/";

const OPTIONS: CaptureOptions = {
  dsn: DSN,
  requestId: "req-12345678",
  route: "/api/hooks/sentry-test",
  env: "local",
  release: "dev",
};

const Envelope = z.object({
  header: z.object({ event_id: z.string(), sent_at: z.string(), dsn: z.string() }),
  item: z.object({ type: z.literal("event") }),
  event: z
    .object({
      event_id: z.string(),
      level: z.string(),
      release: z.string(),
      environment: z.string(),
      tags: z.record(z.string(), z.string()),
      fingerprint: z.array(z.string()).optional(),
      exception: z.object({
        values: z.array(
          z.object({
            type: z.string(),
            value: z.string(),
            stacktrace: z.object({ frames: z.array(z.object({ function: z.string() })) }),
          }),
        ),
      }),
    })
    .passthrough(),
});

const Init = z.object({
  method: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  // Optional so a send without a timeout hangs here instead of failing the parse.
  signal: z.instanceof(AbortSignal).optional(),
});

type Answer = (signal: AbortSignal | undefined) => Promise<Response>;

let answer: Answer;
const fetchMock = vi.fn((_url: string, init: unknown) => answer(Init.parse(init).signal));
const logged: string[] = [];
const otherConsole: string[] = [];

async function load() {
  vi.resetModules();
  return import("../../src/server/lib/sentry");
}

const parseJson = (text: string): unknown => JSON.parse(text);

function sent(index = 0) {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`no fetch number ${String(index)}`);
  const [header, item, event] = Init.parse(call[1]).body.split("\n");
  return {
    url: call[0],
    init: Init.parse(call[1]),
    envelope: Envelope.parse({
      header: parseJson(header ?? ""),
      item: parseJson(item ?? ""),
      event: parseJson(event ?? ""),
    }),
  };
}

const failedLines = () =>
  logged.map((line) => z.record(z.string(), z.unknown()).parse(parseJson(line)));

function boom(): Error {
  return new TypeError("the same failure");
}

function boomElsewhere(): Error {
  return new TypeError("the same failure");
}

function failWith(kind: ErrorConstructor): Error {
  return new kind("the same failure");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  answer = () => Promise.resolve(new Response(null, { status: 200 }));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // Node's AbortSignal.timeout ignores fake timers; this one runs on them.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new DOMException("timed out", "TimeoutError"));
    }, ms);
    return controller.signal;
  });
  logged.length = 0;
  otherConsole.length = 0;
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  for (const method of ["log", "warn", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      otherConsole.push(String(line));
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scrubEvent", () => {
  it("lets no personal data through and keeps the request id", async () => {
    const { scrubEvent } = await load();
    const fixture: SentryEvent = {
      event_id: "abc",
      timestamp: 1,
      platform: "javascript",
      level: "error",
      release: "dev",
      environment: "local",
      tags: { request_id: "req-12345678", route: "/contact" },
      message: "could not reach jane@example.com",
      exception: {
        values: [
          {
            type: "Error",
            value: `failed for jane@example.com ${"x".repeat(400)}`,
            stacktrace: { frames: [] },
          },
        ],
      },
      user: { name: "Jane Example", email: "jane@example.com", ip_address: "203.0.113.9" },
      request: {
        url: "https://matterofplace.com/contact?email=jane@example.com",
        query_string: "email=jane@example.com",
        cookies: { session: "secret-cookie" },
        headers: { authorization: "Bearer secret-token", cookie: "session=secret-cookie" },
        data: { message: "my phone is 555 0100" },
      },
      contexts: { geo: { city: "Tiburon" } },
      breadcrumbs: [{ message: "clicked submit" }],
    };
    const scrubbed = scrubEvent(fixture);
    const json = JSON.stringify(scrubbed);
    expect(scrubbed.user).toEqual({ geo: {} });
    expect(scrubbed).not.toHaveProperty("request");
    expect(scrubbed).not.toHaveProperty("contexts");
    expect(scrubbed).not.toHaveProperty("breadcrumbs");
    for (const secret of [
      "Jane Example",
      "jane@example.com",
      "203.0.113.9",
      "ip_address",
      "secret-cookie",
      "authorization",
      "secret-token",
      "email=",
      "555 0100",
      "Tiburon",
      "clicked submit",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(scrubbed.tags["request_id"]).toBe("req-12345678");
    // Without these Sentry stores the sender's IP, and city and country, on the event.
    expect(scrubbed.sdk?.settings.infer_ip).toBe("never");
    expect(scrubbed.message).toBe("could not reach [email]");
    expect(scrubbed.exception?.values[0]?.value).toHaveLength(200);
    expect(scrubbed.exception?.values[0]?.value.startsWith("failed for [email] ")).toBe(true);
  });
});

describe("captureException", () => {
  it("posts one envelope to the DSN's envelope URL with the tags and a masked message", async () => {
    const { captureException } = await load();
    await captureException(new Error("no thanks from test@example.com"), OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, envelope } = sent();
    expect(url).toBe(ENVELOPE_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=publickey123");
    expect(envelope.header.dsn).toBe(DSN);
    expect(envelope.header.event_id).toBe(envelope.event.event_id);
    expect(envelope.event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(envelope.event.tags).toEqual({
      request_id: "req-12345678",
      route: "/api/hooks/sentry-test",
      env: "local",
      release: "dev",
      side: "worker",
    });
    expect(envelope.event.level).toBe("error");
    expect(envelope.event.release).toBe("dev");
    expect(envelope.event.environment).toBe("local");
    expect(envelope.event.exception.values[0]?.type).toBe("Error");
    expect(envelope.event.exception.values[0]?.value).toBe("no thanks from [email]");
    expect(envelope.event.exception.values[0]?.stacktrace.frames.length).toBeGreaterThan(0);
    expect(envelope.event["user"]).toEqual({ geo: {} });
    expect(envelope.event).not.toHaveProperty("fingerprint");
  });

  it("lists the frames oldest first, so the throwing frame is last", async () => {
    const { captureException } = await load();
    await captureException(boom(), OPTIONS);
    const frames = sent().envelope.event.exception.values[0]?.stacktrace.frames ?? [];
    expect(frames.at(-1)?.function).toBe("boom");
    expect(frames[0]?.function).not.toBe("boom");
  });

  it("masks an address in a tag value", async () => {
    const { captureException } = await load();
    await captureException(new Error("x"), { ...OPTIONS, route: "/people/jane@example.com" });
    expect(sent().envelope.event.tags["route"]).toBe("/people/[email]");
  });

  it("sends side, fingerprint and level when given", async () => {
    const { captureException } = await load();
    await captureException(new Error("quota"), {
      ...OPTIONS,
      side: "browser",
      fingerprint: ["alert", "x"],
      level: "warning",
    });
    const { envelope } = sent();
    expect(envelope.event.tags["side"]).toBe("browser");
    expect(envelope.event.fingerprint).toEqual(["alert", "x"]);
    expect(envelope.event.level).toBe("warning");
  });

  it("returns at once without a DSN", async () => {
    const { captureException } = await load();
    await captureException(new Error("x"), { ...OPTIONS, dsn: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("logs a DSN it cannot parse and sends nothing", async () => {
    const { captureException } = await load();
    await captureException(new Error("x"), { ...OPTIONS, dsn: "not a dsn" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failedLines()).toEqual([
      { level: "error", event: "sentry_send_failed", requestId: "req-12345678", status: null },
    ]);
  });

  it.each([
    {
      name: "a rejected fetch",
      reply: () => Promise.reject(new TypeError("network down")),
      status: null,
    },
    {
      name: "a 500 answer",
      reply: () => Promise.resolve(new Response(null, { status: 500 })),
      status: 500,
    },
  ])("resolves on $name and logs one sentry_send_failed", async ({ reply, status }) => {
    const { captureException } = await load();
    answer = reply;
    await expect(captureException(new Error("x"), OPTIONS)).resolves.toBeUndefined();
    expect(failedLines()).toEqual([
      { level: "error", event: "sentry_send_failed", requestId: "req-12345678", status },
    ]);
    expect(otherConsole).toEqual([]);
  });

  it("gives up on a fetch that never answers after 2 seconds", async () => {
    const { captureException } = await load();
    answer = (signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const done = captureException(new Error("x"), OPTIONS);
    await vi.advanceTimersByTimeAsync(2001);
    await expect(done).resolves.toBeUndefined();
    expect(failedLines()).toEqual([
      { level: "error", event: "sentry_send_failed", requestId: "req-12345678", status: null },
    ]);
    expect(otherConsole).toEqual([]);
  });

  it.each([
    { name: "a null-prototype object", value: (): unknown => Object.create(null) },
    {
      name: "an Error whose message getter throws",
      value: (): unknown =>
        Object.defineProperty(new Error("x"), "message", {
          get() {
            throw new Error("no message");
          },
        }),
    },
    {
      name: "a proxy that refuses instanceof",
      value: (): unknown =>
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("no prototype");
            },
          },
        ),
    },
  ])("resolves and sends one event for $name", async ({ value }) => {
    const { captureException } = await load();
    await expect(captureException(value(), OPTIONS)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().envelope.event.exception.values[0]).toMatchObject({
      type: "object",
      value: "unprintable value",
    });
  });

  it("sends an Error whose name and message are not strings", async () => {
    const { captureException } = await load();
    const error = Object.assign(new Error("x"), { name: 5, message: 6 });
    await expect(captureException(error, OPTIONS)).resolves.toBeUndefined();
    expect(sent().envelope.event.exception.values[0]).toMatchObject({ type: "5", value: "6" });
  });
});

describe("one event per fingerprint and the rate limits (INT-12)", () => {
  it("sends 100 identical throws within a minute once, and again after 61 seconds", async () => {
    const { captureException } = await load();
    for (let count = 0; count < 100; count += 1) {
      await captureException(boom(), OPTIONS);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-02T12:01:01Z"));
    await captureException(boom(), OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "another route",
      first: () => boom(),
      second: () => boom(),
      secondRoute: "/other",
    },
    {
      name: "another error class",
      first: () => failWith(TypeError),
      second: () => failWith(RangeError),
      secondRoute: OPTIONS.route,
    },
    {
      name: "another first stack frame",
      first: () => boom(),
      second: () => boomElsewhere(),
      secondRoute: OPTIONS.route,
    },
  ])(
    "sends the same message again at once from $name (route, class and first frame)",
    async ({ first, second, secondRoute }) => {
      const { captureException } = await load();
      await captureException(first(), OPTIONS);
      await captureException(second(), { ...OPTIONS, route: secondRoute });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("sends two errors with different fingerprints twice", async () => {
    const { captureException } = await load();
    await captureException(boom(), { ...OPTIONS, fingerprint: ["alert", "a"] });
    await captureException(boom(), { ...OPTIONS, fingerprint: ["alert", "b"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "a 429 with Retry-After: 60",
      status: 429,
      headers: { "retry-after": "60" },
      seconds: 60,
    },
    {
      name: "a 429 with Retry-After: 120",
      status: 429,
      headers: { "retry-after": "120" },
      seconds: 120,
    },
    {
      name: "X-Sentry-Rate-Limits 60",
      status: 200,
      headers: { "x-sentry-rate-limits": "60:error:key" },
      seconds: 60,
    },
    {
      name: "X-Sentry-Rate-Limits 30 and 120",
      status: 200,
      headers: { "x-sentry-rate-limits": "30:transaction:key, 120:error:key" },
      seconds: 120,
    },
  ])("pauses every send for the window named by $name", async ({ status, headers, seconds }) => {
    const { captureException } = await load();
    answer = () => Promise.resolve(new Response(null, { status, headers }));
    await captureException(new Error("first"), OPTIONS);
    answer = () => Promise.resolve(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1000);
    await captureException(new RangeError("another problem"), { ...OPTIONS, route: "/other" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_001);
    await captureException(new RangeError("another problem"), { ...OPTIONS, route: "/other" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
