import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { turnstileHostAllowed, verifyTurnstile } from "../../src/server/lib/turnstile";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const REAL_SECRET = "0x4AAAAAAA-real-secret";
const IP = "203.0.113.7";

const Init = z.object({
  method: z.string(),
  body: z.instanceof(URLSearchParams),
  // Optional so a call without a timeout hangs here instead of failing the parse.
  signal: z.instanceof(AbortSignal).optional(),
});

type Answer = (signal: AbortSignal | undefined) => Promise<Response>;

let answer: Answer;
const fetchMock = vi.fn((_url: string, init: unknown) => answer(Init.parse(init).signal));

const siteverify =
  (body: Record<string, unknown>): Answer =>
  () =>
    Promise.resolve(Response.json(body));

const production = { MOP_ENV: "production", TURNSTILE_SECRET: REAL_SECRET };

beforeEach(() => {
  vi.useFakeTimers();
  answer = siteverify({ success: true });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // Node's AbortSignal.timeout ignores fake timers (P-080); this one runs on them.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new DOMException("timed out", "TimeoutError"));
    }, ms);
    return controller.signal;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile outcomes", () => {
  it("passes when siteverify says success, posting the secret, the token and the address", async () => {
    const outcome = await verifyTurnstile(
      "tok",
      IP,
      { MOP_ENV: "local", TURNSTILE_SECRET: TEST_SECRET },
      "inquiries",
    );
    expect(outcome).toBe("pass");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(SITEVERIFY);
    const sent = Init.parse(init);
    expect(sent.method).toBe("POST");
    expect(Object.fromEntries(sent.body)).toEqual({
      secret: TEST_SECRET,
      response: "tok",
      remoteip: IP,
    });
  });

  it("fails when siteverify says the token is no good", async () => {
    answer = siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    const outcome = await verifyTurnstile("tok", IP, production, "inquiries");
    expect(outcome).toBe("fail");
  });

  it("is unreachable on a network error", async () => {
    answer = () => Promise.reject(new TypeError("fetch failed"));
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("unreachable");
  });

  it("is unreachable on a 5xx from Cloudflare", async () => {
    answer = () => Promise.resolve(Response.json({ success: false }, { status: 503 }));
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("unreachable");
  });

  it("is unreachable on an answer that is not siteverify's", async () => {
    answer = () => Promise.resolve(new Response("<html>", { status: 200 }));
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("unreachable");
  });

  it("gives up after 2 seconds with no answer", async () => {
    answer = (signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const pending = verifyTurnstile("tok", IP, production, "inquiries");
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBe("unreachable");
  });

  it("is unreachable with no secret configured, before it looks at the token", async () => {
    expect(await verifyTurnstile("tok", IP, { MOP_ENV: "local" }, "inquiries")).toBe("unreachable");
    expect(
      await verifyTurnstile(undefined, IP, { MOP_ENV: "local", TURNSTILE_SECRET: "" }, "x"),
    ).toBe("unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ""])(
    "fails an absent or empty token (%j) when a secret is set, without calling siteverify",
    async (token) => {
      expect(await verifyTurnstile(token, IP, production, "inquiries")).toBe("fail");
      expect(await verifyTurnstile(token, IP, { ...production, MOP_ENV: "preview" }, "x")).toBe(
        "fail",
      );
      expect(
        await verifyTurnstile(token, IP, { MOP_ENV: "local", TURNSTILE_SECRET: TEST_SECRET }, "x"),
      ).toBe("fail");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("verifyTurnstile hostname and action (INT-02)", () => {
  const good = { success: true, hostname: "matterofplace.com", action: "inquiries" };

  it("passes the right hostname with the right action", async () => {
    answer = siteverify(good);
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("pass");
  });

  it("fails a success whose hostname is not one the environment serves", async () => {
    answer = siteverify({ ...good, hostname: "evil.example" });
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("fail");
  });

  it("fails a success that names no hostname", async () => {
    answer = siteverify({ success: true, action: "inquiries" });
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("fail");
  });

  it("fails a success whose action is another route's or absent", async () => {
    answer = siteverify({ ...good, action: "subscribers" });
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("fail");
    answer = siteverify({ success: true, hostname: "matterofplace.com" });
    expect(await verifyTurnstile("tok", IP, production, "inquiries")).toBe("fail");
  });

  it.each(["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA"])(
    "checks neither hostname nor action with the test secret %s",
    async (secret) => {
      answer = siteverify({ success: true, hostname: "evil.example", action: "subscribers" });
      const outcome = await verifyTurnstile(
        "tok",
        IP,
        { MOP_ENV: "production", TURNSTILE_SECRET: secret },
        "inquiries",
      );
      expect(outcome).toBe("pass");
    },
  );

  it("still fails a failure with the test secret", async () => {
    answer = siteverify({ success: false });
    const outcome = await verifyTurnstile(
      "tok",
      IP,
      { MOP_ENV: "production", TURNSTILE_SECRET: TEST_SECRET },
      "inquiries",
    );
    expect(outcome).toBe("fail");
  });
});

describe("turnstileHostAllowed", () => {
  it("allows the site's hosts in production and nothing else", () => {
    for (const host of [
      "matterofplace.com",
      "www.matterofplace.com",
      "matter-of-place.holy-meadow-4327.workers.dev",
    ]) {
      expect(turnstileHostAllowed(host, "production")).toBe(true);
    }
    for (const host of [
      "evil.example",
      "matterofplace.com.evil.example",
      "pr-7.holy-meadow-4327.workers.dev",
      "matter-of-place-dev.holy-meadow-4327.workers.dev",
    ]) {
      expect(turnstileHostAllowed(host, "production")).toBe(false);
    }
  });

  it("allows the dev Worker and a pull request's preview in preview, not production's host", () => {
    expect(
      turnstileHostAllowed("matter-of-place-dev.holy-meadow-4327.workers.dev", "preview"),
    ).toBe(true);
    expect(turnstileHostAllowed("pr-12.holy-meadow-4327.workers.dev", "preview")).toBe(true);
    expect(turnstileHostAllowed("pr-x.holy-meadow-4327.workers.dev", "preview")).toBe(false);
    expect(turnstileHostAllowed("pr-12.holy-meadow-4327.workers.dev.evil.example", "preview")).toBe(
      false,
    );
    expect(turnstileHostAllowed("matterofplace.com", "preview")).toBe(false);
  });

  it("allows any host locally, and none for an environment it does not know", () => {
    expect(turnstileHostAllowed("localhost", "local")).toBe(true);
    expect(turnstileHostAllowed("matterofplace.com", "staging")).toBe(false);
  });
});
