// B16 step 3: `GET /api/public/site` and `getSiteSettings` read the site from the shared public state only (S52).
import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { countingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

const SITE = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};
const CALLS = 200;

// The state memo lives in module state: a fresh module graph per test.
async function load() {
  vi.resetModules();
  return {
    service: await import("../../src/server/settings/service"),
    pipeline: await import("../../src/server/public/pipeline"),
  };
}

// A payload that carries more than the site, as the real `public_state()` does.
function stateDb() {
  return countingDb(
    fakeDb({
      rpc: {
        public_state: () =>
          stateJson(7, {
            site: SITE,
            flags: { newsletter_enabled: true },
            environment: "development",
            illustrative_content: true,
          }),
      },
    }),
  );
}

const siteRequest = () =>
  new Request("https://matterofplace.com/api/public/site", {
    headers: { "cf-connecting-ip": "198.51.100.7" },
  });

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the site read path", () => {
  it("makes one public_state call and no table read in 200 reads of the service and of the route", async () => {
    const { service, pipeline } = await load();
    const db = stateDb();
    for (let call = 0; call < CALLS; call += 1) {
      await service.getSiteSettings(db);
      await pipeline.handlePublic(siteRequest(), "r1", db);
    }
    expect(db.counts.rpc).toEqual({ public_state: 1 });
    expect(db.counts.from).toEqual({});
  }, 30_000);

  it("asks again for every call when the memo interval is zero, which is what holds the count down", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { service, pipeline } = await load();
    const db = stateDb();
    await service.getSiteSettings(db);
    await pipeline.handlePublic(siteRequest(), "r1", db);
    expect(db.counts.rpc["public_state"]).toBeGreaterThan(1);
  });

  it("answers with the site and illustrativeContent and no other key of the public state (invariant 3)", async () => {
    const { pipeline } = await load();
    const response = await pipeline.handlePublic(siteRequest(), "r1", stateDb());
    expect(response.status).toBe(200);
    const body = z.record(z.string(), z.unknown()).parse(await response.json());
    expect(body).toEqual({ ...SITE, illustrativeContent: true });
    expect(Object.keys(body).sort()).toEqual(["contact", "illustrativeContent", "legal", "social"]);
  });

  it("answers illustrativeContent false in production although the database says true (F26 c, invariant 6)", async () => {
    const { routes } = await import("../../src/server/public/routes");
    const { env } = await import("../../src/server/lib/env");
    const row = routes.find((candidate) => candidate.path === "/api/public/site");
    if (row === undefined || row.raw === true) throw new Error("the site row is a JSON read");
    const ctx = {
      requestId: "r1",
      ipHash: "hash",
      turnstileOk: false,
      wait: () => undefined,
      env: { ...env, MOP_ENV: "production" as const },
    };
    const body = z
      .record(z.string(), z.unknown())
      .parse(await row.service(stateDb(), undefined, ctx));
    expect(body["illustrativeContent"]).toBe(false);
    expect(body["contact"]).toEqual(SITE.contact);
  });
});
