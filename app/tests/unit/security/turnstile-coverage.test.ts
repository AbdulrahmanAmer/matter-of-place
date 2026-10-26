import "../../fixtures/worker-env";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { routes } from "../../../src/server/public/routes";
import { PUBLIC_FORMS } from "../../../../workspace/audits/tools/public-forms.mjs";
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
  "/api/public/subscribers/unsubscribe":
    "a mail client's one-click POST (RFC 8058); the signed token in the address names the one reader",
};

const inquiry: unknown = JSON.parse(
  readFileSync(new URL("../../fixtures/inquiry.json", import.meta.url), "utf8"),
);

// A valid body for each checked write, so a refusal below is Turnstile's and never the schema's.
const VALID: Readonly<Record<string, unknown>> = {
  "/api/public/inquiries": inquiry,
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

// H79 (6): the forms of the site are one table, `workspace/audits/tools/public-forms.mjs`, which the security collector
// also reads. Every public form that writes carries Turnstile with no exception; a form that only reads is exempt by
// its row. A form component no row names, or a writing row without Turnstile, fails here.
describe("the table of public forms", () => {
  const writing = PUBLIC_FORMS.filter((form) => form.writes);
  const src = new URL("../../../src/", import.meta.url);

  /** Files under src/components and src/routes that hold a public form: a `<form>` tag or a form action. */
  function formFiles(folder: string): string[] {
    const found: string[] = [];
    const walk = (dir: URL, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          const text = readFileSync(new URL(entry.name, dir), "utf8");
          if (/<form\b|useAsyncAction\(/.test(text)) found.push(`${prefix}${entry.name}`);
        }
      }
    };
    walk(new URL(`${folder}/`, src), `${folder}/`);
    return found;
  }

  it("has a row per form with its own id", () => {
    const ids = PUBLIC_FORMS.map((form) => form.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every form that writes Turnstile, with no exception", () => {
    expect(writing.length).toBeGreaterThan(0);
    expect(writing.filter((form) => !form.turnstile).map((form) => form.id)).toEqual([]);
  });

  it("exempts a form only when it reads, and says why", () => {
    const exempt = PUBLIC_FORMS.filter((form) => !form.turnstile);
    expect(exempt.filter((form) => form.writes).map((form) => form.id)).toEqual([]);
    expect(
      exempt.filter((form) => (form.reason ?? "").trim() === "").map((form) => form.id),
    ).toEqual([]);
  });

  it("sends every writing form to a POST row of the route table that checks Turnstile", () => {
    const apis = writing.filter((form) => form.verifiedIn === undefined).map((form) => form.api);
    expect(apis.every((api) => api !== null)).toBe(true);
    const unchecked = apis.filter(
      (api) => !posts.some((route) => route.path === api && route.turnstile),
    );
    expect(unchecked).toEqual([]);
  });

  it("makes a form that writes through a server function ask for the token and verify it in its service", () => {
    const viaFunction = writing.filter((form) => form.verifiedIn !== undefined);
    expect(viaFunction.length).toBeGreaterThan(0);
    const bad = viaFunction.filter((form) => {
      const asks = form.components.every((file) =>
        readFileSync(new URL(file, src), "utf8").includes("getTurnstileToken("),
      );
      const verifies = readFileSync(new URL(form.verifiedIn ?? "", src), "utf8").includes(
        "verifyTurnstile(",
      );
      return !(asks && verifies && form.api === null);
    });
    expect(bad.map((form) => form.id)).toEqual([]);
  });

  it("lists as a writing form every POST row the route table marks as a form write", () => {
    const marked = posts.filter((route) => route.form === true).map((route) => route.path);
    const apis = writing.map((form) => form.api).filter((api) => api !== null);
    expect([...new Set(apis)].sort()).toEqual([...marked].sort());
  });

  it("names every component under src/components and src/routes that holds a form", () => {
    const named = new Set(PUBLIC_FORMS.flatMap((form) => form.components));
    const files = [...formFiles("components"), ...formFiles("routes")];
    expect(files.filter((file) => !named.has(file))).toEqual([]);
  });

  it("names only components that exist and still hold a form", () => {
    const missing = PUBLIC_FORMS.flatMap((form) => form.components).filter(
      (file) => !/<form\b|useAsyncAction\(/.test(readFileSync(new URL(file, src), "utf8")),
    );
    expect(missing).toEqual([]);
  });
});
