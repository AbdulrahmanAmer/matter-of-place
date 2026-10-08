import "../../fixtures/worker-env";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { routes } from "../../../src/server/public/routes";
import { fakeDb } from "../../fixtures/fake-db";

// H1-01: Turnstile on every public write. Every POST row of B3's route table, the table every handler dispatches
// through, either checks Turnstile or is named here with the reason it does not.
const TURNSTILE_EXEMPT: Readonly<Record<string, string>> = {
  "/api/public/submissions/:id/uploads":
    "signs more URLs only with the upload token of a submission that passed",
  "/api/public/events": "a browser beacon of analytics events",
  "/api/public/csp-report": "a browser beacon the browser sends itself",
  "/api/public/client-error": "a browser beacon of client errors",
  "/api/public/search": "a read sent by POST",
  "/api/public/concierge": "a read sent by POST",
  "/api/hooks/resend": "signature-checked over the raw body",
};

// A valid body for each checked write, so a refusal below is Turnstile's and never the schema's.
const VALID: Readonly<Record<string, unknown>> = {
  "/api/public/inquiries": JSON.parse(
    readFileSync(new URL("../../fixtures/inquiry.json", import.meta.url), "utf8"),
  ),
  "/api/public/submissions": {
    address: "1 Probe Lane",
    city: "Los Angeles",
    state: "California",
    zip: "90001",
    currency: "USD",
    propertyType: "Residence",
    submitterKind: "owner",
    submitterName: "H1 Probe",
    submitterEmail: "h1@example.invalid",
    story: "A story.",
    significance: "A significance.",
    package: "The Feature",
    rightsConfirmed: true,
    sourcePath: "/submit",
  },
  "/api/public/subscribers": { email: "h1@example.invalid", source: "home", markets: [] },
  "/api/public/subjects/request": { email: "h1@example.invalid", kind: "access" },
};

// Cloudflare's always-fail test secret: siteverify answers `success: false` to every token it is sent with.
const ALWAYS_FAIL_SECRET = "2x0000000000000000000000000000000AA";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const siteverify = vi.fn<(url: string, init: unknown) => Promise<Response>>();

const posts = routes.filter((route) => route.method === "POST");
const checked = posts.filter((route) => route.turnstile).map((route) => route.path);

const errorBody = z.object({ error: z.object({ code: z.string() }) });

function post(path: string, token?: string): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.9",
  });
  if (token !== undefined) headers.set("x-turnstile-token", token);
  return new Request(`https://matterofplace.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(VALID[path] ?? {}),
  });
}

/** Lets every rate-limit check pass, so a write that gets past Turnstile reaches the database. */
const limitsPass = () =>
  fakeDb({ rpc: { rate_limit_check: () => [{ allowed: true, retry_after: 0 }] } });

const answer = (success: boolean) => {
  siteverify.mockImplementation(() =>
    Promise.resolve(
      Response.json(success ? { success } : { success, "error-codes": ["invalid-input-response"] }),
    ),
  );
};

async function load() {
  vi.resetModules();
  return import("../../../src/server/public/pipeline");
}

beforeEach(() => {
  siteverify.mockReset();
  answer(false);
  vi.stubEnv("TURNSTILE_SECRET", ALWAYS_FAIL_SECRET);
  vi.stubGlobal("fetch", siteverify);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Turnstile coverage of the public writes", () => {
  it("every POST row checks Turnstile or is exempt with a reason", () => {
    const uncovered = posts
      .filter((route) => !route.turnstile && TURNSTILE_EXEMPT[route.path] === undefined)
      .map((route) => route.path);
    expect(uncovered).toEqual([]);
  });

  it("names no exemption that is not an unchecked POST row", () => {
    const unchecked = new Set(posts.filter((route) => !route.turnstile).map((route) => route.path));
    expect(Object.keys(TURNSTILE_EXEMPT).filter((path) => !unchecked.has(path))).toEqual([]);
  });

  it("checks the four form writes", () => {
    expect([...checked].sort()).toEqual(Object.keys(VALID).sort());
  });

  it.each(checked)("refuses %s without a token: 403 forbidden, no database call", async (path) => {
    const { handlePublic } = await load();
    const db = limitsPass();
    const response = await handlePublic(post(path), "req-12345678", db);
    expect(response.status).toBe(403);
    expect(errorBody.parse(await response.json()).error.code).toBe("forbidden");
    expect(siteverify).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it.each(checked)(
    "refuses %s with a token the always-fail secret fails: 403 forbidden, no database call",
    async (path) => {
      const { handlePublic } = await load();
      const db = limitsPass();
      const response = await handlePublic(post(path, TOKEN), "req-12345678", db);
      expect(response.status).toBe(403);
      expect(errorBody.parse(await response.json()).error.code).toBe("forbidden");
      expect(siteverify).toHaveBeenCalledTimes(1);
      expect(db.calls).toEqual([]);
    },
  );

  it.each(checked)(
    "lets %s reach the rate limit once the token passes, so the refusals are Turnstile's",
    async (path) => {
      answer(true);
      const { handlePublic } = await load();
      const db = limitsPass();
      await handlePublic(post(path, TOKEN), "req-12345678", db);
      expect(db.calls.map((call) => call.name)).toContain("rate_limit_check");
    },
  );
});
