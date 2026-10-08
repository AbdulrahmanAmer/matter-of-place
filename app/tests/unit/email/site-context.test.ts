// B16 step 4: `loadSiteContext` fills the identity lines of every email from `settings.site` through the shared
// public state, never through a table read of its own.
import { beforeEach, describe, expect, it } from "vitest";
import type { Json } from "../../../src/db";
import { loadSiteContext } from "../../../src/server/email/context";
import { resetPublicStateMemo } from "../../../src/server/public/state";
import { countingDb } from "../../fixtures/db-counter";
import { fakeDb } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";

const SITE_URL = "https://dev.example.invalid";
const SET_SITE = {
  contact: { email: "hello@example.test", phone: "+1 555 010 0100", privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};

const stateDb = (site: Json) =>
  countingDb(fakeDb({ rpc: { public_state: () => stateJson(7, { site }) } }));

beforeEach(() => {
  resetPublicStateMemo();
});

describe("loadSiteContext", () => {
  it("maps an all-set site to entity, address and the contact email, with one state read and no table read", async () => {
    const db = stateDb(SET_SITE);
    expect(await loadSiteContext(db, SITE_URL)).toEqual({
      siteUrl: SITE_URL,
      entity: "Example Test LLC",
      address: "1 Test Street, Testville, CA 90000",
      contact: { email: "hello@example.test" },
    });
    expect(db.counts).toEqual({ rpc: { public_state: 1 }, from: {}, storage: {}, total: 1 });
  });

  it("maps an empty site to nulls", async () => {
    const db = stateDb(null);
    expect(await loadSiteContext(db, SITE_URL)).toEqual({
      siteUrl: SITE_URL,
      entity: null,
      address: null,
      contact: { email: null },
    });
    expect(db.counts.from).toEqual({});
  });
});
