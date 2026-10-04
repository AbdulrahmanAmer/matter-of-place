// B8 step 8: the provider checks of the health job (INT-07, ruling H34 (1)). fetch is a spy; the database is B3's
// fakeDb with the one settings read the LinkedIn check makes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db";
import type { HealthCheck, HealthContext } from "../../../src/server/jobs/system/health";
import { providerChecks } from "../../../src/server/jobs/system/health/providers";
import type { RunnerEnv } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T13:00:00.000Z");
const DAY_MS = 24 * 3600 * 1000;
const GITHUB_ENV: RunnerEnv = {
  GITHUB_DISPATCH_TOKEN: "test-dispatch-token",
  GITHUB_REPO: "AbdulrahmanAmer/matter-of-place",
};
const RESEND_ENV: RunnerEnv = { RESEND_API_KEY: "re_test" };

const fetchSpy = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function context(env: RunnerEnv, linkedin: Json | null = null): HealthContext {
  const db = fakeDb();
  const settingsRead = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: linkedin === null ? null : { value: linkedin }, error: null }),
        }),
      }),
    }),
  };
  return {
    db: Object.assign(db, settingsRead),
    env,
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "health",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
    counts: () => Promise.reject(new Error("a provider check never reads health_counts")),
  };
}

function check(name: string): HealthCheck {
  const found = providerChecks.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no provider check ${name}`);
  return found;
}

/** GitHub's own spelling of a token expiry `days` from NOW. */
const expiry = (days: number) =>
  new Date(NOW.getTime() + days * DAY_MS)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");

const github = (status: number, header?: string) =>
  new Response("{}", {
    status,
    headers: header === undefined ? {} : { "github-authentication-token-expiration": header },
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  fetchSpy.mockReset();
  vi.unstubAllGlobals();
});

describe("providerChecks", () => {
  it("is exactly github_dispatch, resend_domain and linkedin_version, with no model check", () => {
    expect(providerChecks.map((entry) => entry.name)).toEqual([
      "github_dispatch",
      "resend_domain",
      "linkedin_version",
    ]);
  });

  it("each check skips while its credential is absent and calls nothing", async () => {
    const results = await Promise.all(providerChecks.map((entry) => entry.run(context({}))));
    expect(results.map((result) => result.status)).toEqual(["skip", "skip", "skip"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("github_dispatch", () => {
  it("is ok with no expiry header, and sends the token and the job's signal", async () => {
    fetchSpy.mockResolvedValue(github(200));
    const ctx = context(GITHUB_ENV);
    const result = await check("github_dispatch").run(ctx);
    expect(result.status).toBe("ok");
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/repos/AbdulrahmanAmer/matter-of-place");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-dispatch-token");
    expect(init?.signal).toBe(ctx.signal);
  });

  it("is warn under 14 days, ok at 20 days, and fail once expired", async () => {
    const statuses = [];
    for (const days of [10, 20, -1]) {
      fetchSpy.mockResolvedValueOnce(github(200, expiry(days)));
      statuses.push((await check("github_dispatch").run(context(GITHUB_ENV))).status);
    }
    expect(statuses).toEqual(["warn", "ok", "fail"]);
  });

  it("is fail on 401", async () => {
    fetchSpy.mockResolvedValue(github(401));
    expect((await check("github_dispatch").run(context(GITHUB_ENV))).status).toBe("fail");
  });

  it("is warn when GitHub cannot be reached", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    expect(await check("github_dispatch").run(context(GITHUB_ENV))).toEqual({
      status: "warn",
      message: "could not reach GitHub: network down",
    });
  });
});

describe("resend_domain", () => {
  const domains = (status: string) =>
    new Response(JSON.stringify({ data: [{ id: "d1", name: "matterofplace.com", status }] }), {
      status: 200,
    });

  it("is ok when matterofplace.com is verified", async () => {
    fetchSpy.mockResolvedValue(domains("verified"));
    expect((await check("resend_domain").run(context(RESEND_ENV))).status).toBe("ok");
    expect(new Headers(fetchSpy.mock.calls[0]?.[1].headers).get("authorization")).toBe(
      "Bearer re_test",
    );
  });

  it("is fail when the domain is pending, missing, or Resend answers an error", async () => {
    const answers = [
      domains("pending"),
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
      new Response("{}", { status: 401 }),
    ];
    const statuses = [];
    for (const answer of answers) {
      fetchSpy.mockResolvedValueOnce(answer);
      statuses.push((await check("resend_domain").run(context(RESEND_ENV))).status);
    }
    expect(statuses).toEqual(["fail", "fail", "fail"]);
  });
});

describe("linkedin_version", () => {
  it("is warn once the version is 10 months old and ok before", async () => {
    const old = await check("linkedin_version").run(context({}, { api_version: "202512" }));
    const recent = await check("linkedin_version").run(context({}, { api_version: "202601" }));
    expect([old.status, recent.status]).toEqual(["warn", "ok"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
