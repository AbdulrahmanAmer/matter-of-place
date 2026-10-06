import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fakeDb } from "../fixtures/fake-db";
import { fakeAuth, routeHandler, SITE, stubAuthEnv } from "../fixtures/supabase-auth";

// Invariant 19, SEC-12, API-04: a sign-in link is sent only after Turnstile and the limits pass and only to an
// address that may sign in, and every request answers `sent`, so nothing can be enumerated or spent.

const SITEVERIFY = "challenges.cloudflare.com";
const checksSchema = z.array(
  z.object({
    bucket: z.string(),
    key_hash: z.string(),
    limit: z.number(),
    window_seconds: z.number(),
  }),
);

async function sendLink(staff: boolean, turnstile: boolean) {
  const auth = fakeAuth([], (url) => {
    if (url.hostname === SITEVERIFY) return Response.json({ success: turnstile });
    if (url.pathname === "/auth/v1/otp") return Response.json({});
    return undefined;
  });
  const hits = new Map<string, number>();
  const db = fakeDb({
    rpc: {
      staff_can_sign_in: () => staff,
      rate_limit_check: ({ p_checks }) => {
        const checks = checksSchema.parse(p_checks);
        const id = (check: z.infer<typeof checksSchema>[number]) =>
          `${check.bucket}|${check.key_hash}`;
        if (checks.some((check) => (hits.get(id(check)) ?? 0) >= check.limit)) {
          return [{ allowed: false, retry_after: 60 }];
        }
        for (const check of checks) hits.set(id(check), (hits.get(id(check)) ?? 0) + 1);
        return [{ allowed: true, retry_after: 0 }];
      },
    },
  });
  stubAuthEnv();
  vi.resetModules();
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(db);
  const handler = routeHandler(await import("../../src/routes/api/admin/auth.send-link"), "POST");
  const send = async (email: string, token: string | null, ip = "203.0.113.9") => {
    const response = await handler({
      request: new Request(`${SITE}/api/admin/auth/send-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
          ...(token === null ? {} : { "x-turnstile-token": token }),
        },
        body: JSON.stringify({ email }),
      }),
      context: { requestId: "r1" },
    });
    const body: unknown = await response.json();
    return { status: response.status, body };
  };
  const otpCalls = () => auth.calls.filter((call) => call.url.includes("/auth/v1/otp"));
  return { send, otpCalls, auth };
}

const SENT = { status: 200, body: { status: "sent" } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST auth/send-link", () => {
  it("sends one link to a staff address, with no emailRedirectTo", async () => {
    const { send, otpCalls } = await sendLink(true, true);
    expect(await send("Editor@Example.test", "token")).toEqual(SENT);
    const calls = otpCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).not.toContain("redirect_to");
    const body = calls[0]?.init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : null).toMatchObject({
      email: "editor@example.test",
      create_user: false,
    });
  });

  it("answers sent and sends nothing to an unknown or disabled address", async () => {
    const { send, otpCalls } = await sendLink(false, true);
    expect(await send("nobody@example.test", "token")).toEqual(SENT);
    expect(otpCalls()).toEqual([]);
  });

  it("answers sent and sends nothing without a Turnstile token, and never asks Cloudflare", async () => {
    const { send, otpCalls, auth } = await sendLink(true, true);
    expect(await send("editor@example.test", null)).toEqual(SENT);
    expect(otpCalls()).toEqual([]);
    expect(auth.calls).toEqual([]);
  });

  it("answers sent and sends nothing when Turnstile fails", async () => {
    const { send, otpCalls } = await sendLink(true, false);
    expect(await send("editor@example.test", "bad-token")).toEqual(SENT);
    expect(otpCalls()).toEqual([]);
  });

  it("sends nothing for the 4th request for one address inside an hour, from any address", async () => {
    const { send, otpCalls } = await sendLink(true, true);
    for (const ip of ["203.0.113.10", "203.0.113.11", "203.0.113.12", "203.0.113.13"]) {
      expect(await send("editor@example.test", "token", ip)).toEqual(SENT);
    }
    expect(otpCalls()).toHaveLength(3);
  });
});
