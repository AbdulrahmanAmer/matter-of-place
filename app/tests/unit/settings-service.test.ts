// B16 step 2: `settings.site` is read from the shared public state only and written through `settings_put_site`.
import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src/db";
import { countingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

const SET_SITE = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};
const SEEDED = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: null, address: null },
  social: { instagram: null, x: null, linkedin: null },
};
const WRITER = { id: null, kind: "human", note: "script: set-site" } as const;

// The state memo lives in module state: a fresh module per test.
async function load() {
  vi.resetModules();
  return {
    service: await import("../../src/server/settings/service"),
    readiness: await import("../../src/server/settings/readiness"),
    errors: await import("../../src/server/lib/errors"),
  };
}

function stateDb(site: Json) {
  return countingDb(
    fakeDb({ rpc: { public_state: () => stateJson(7, { site, illustrative_content: true }) } }),
  );
}

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSiteSettings", () => {
  it("is the stored site, one public_state call in 200 reads and no table read", async () => {
    const { service } = await load();
    const db = stateDb(SET_SITE);
    for (let call = 1; call < 200; call += 1) await service.getSiteSettings(db);
    expect(await service.getSiteSettings(db)).toEqual(SET_SITE);
    expect(db.counts).toEqual({ rpc: { public_state: 1 }, from: {}, storage: {}, total: 1 });
  });
});

describe("getPublicSite", () => {
  it("is the site with illustrativeContent, from one state read", async () => {
    const { service } = await load();
    const db = stateDb(SET_SITE);
    expect(await service.getPublicSite(db)).toEqual({ ...SET_SITE, illustrativeContent: true });
    expect(db.counts.total).toBe(1);
  });
});

describe("applySiteSettings", () => {
  it("sends the parsed value with a null actor, the writer's kind and note", async () => {
    const { service } = await load();
    const sent: unknown[] = [];
    const db = fakeDb({
      rpc: {
        settings_put_site: (args) => {
          sent.push(args);
          return undefined;
        },
      },
    });
    await service.applySiteSettings(
      db,
      { ...SET_SITE, contact: { email: " hello@example.test ", phone: "" } },
      WRITER,
    );
    expect(sent).toEqual([
      {
        p_value: SET_SITE,
        p_actor: null,
        p_actor_kind: "human",
        p_request_id: null,
        p_note: "script: set-site",
      },
    ]);
  });

  it("refuses an invalid value with 422 validation and its field path, before any call", async () => {
    const { service, errors } = await load();
    const refused: unknown = await service
      .applySiteSettings(fakeDb(), { contact: { email: "not-an-email" } }, WRITER)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(errors.AppError);
    expect(refused).toMatchObject({ code: "validation", issues: [{ path: ["contact", "email"] }] });
  });

  it("throws the function's error code", async () => {
    const { service } = await load();
    const db = fakeDb({
      rpc: { settings_put_site: () => Object.assign(new Error("not_found"), { code: "P0002" }) },
    });
    await expect(service.applySiteSettings(db, SET_SITE, WRITER)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("siteReadiness", () => {
  it("lists the required fields still unset, in screen 24's order", async () => {
    const { readiness } = await load();
    expect(await readiness.siteReadiness(stateDb(SEEDED))).toEqual([
      "legal.entity",
      "legal.address",
    ]);
  });

  it("is empty when every required field is set, whatever the optional ones", async () => {
    const { readiness } = await load();
    expect(await readiness.siteReadiness(stateDb(SET_SITE))).toEqual([]);
  });
});
