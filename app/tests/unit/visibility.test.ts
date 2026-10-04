// The one place a row is hidden (invariant 5): plain objects in, the visible rows out.
import { describe, expect, it } from "vitest";
import type { MarketSlug } from "../../src/domain/market";
import type { Property } from "../../src/domain/property";
import { applyVisibility } from "../../src/server/catalog/visibility";
import { mapSnapshot, parseSnapshot } from "../../src/server/public/mappers";
import type { PublicState } from "../../src/server/public/state";
import { snapshotJson } from "../fixtures/snapshot";

function stateOf(overrides: Partial<PublicState> = {}): PublicState {
  return {
    catalogVersion: 7,
    flags: {},
    comingSoonGlobal: false,
    comingSoonMarkets: { california: false, florida: false, "new-york": false },
    site: {},
    illustrativeContent: false,
    ogStatic: {},
    ...overrides,
  };
}

const base = mapSnapshot(parseSnapshot(snapshotJson()), stateOf());
const [first] = base.properties;
if (first === undefined) throw new Error("the fixture holds one property");
const seed: Property = first;

function rows(...items: [string, MarketSlug, "Active" | "Illustrative"][]) {
  return {
    ...base,
    properties: items.map(([slug, market, status]) => ({ ...seed, slug, market, status })),
  };
}

const slugs = (visible: { properties: { slug: string }[] }) =>
  visible.properties.map((property) => property.slug);

describe("applyVisibility", () => {
  it("drops the properties of a coming-soon market and keeps those of an open one", () => {
    const state = stateOf({
      comingSoonMarkets: { california: true, florida: false, "new-york": false },
    });
    const visible = applyVisibility(
      rows(["ca", "california", "Active"], ["fl", "florida", "Active"]),
      { state, env: { MOP_ENV: "preview" } },
    );
    expect(slugs(visible)).toEqual(["fl"]);
  });

  it("drops every property while the global switch is on", () => {
    const visible = applyVisibility(
      rows(["ca", "california", "Active"], ["fl", "florida", "Active"]),
      { state: stateOf({ comingSoonGlobal: true }), env: { MOP_ENV: "preview" } },
    );
    expect(visible.properties).toEqual([]);
  });

  it("keeps an illustrative row when the setting is on and the environment is local", () => {
    const visible = applyVisibility(rows(["il", "california", "Illustrative"]), {
      state: stateOf({ illustrativeContent: true }),
      env: { MOP_ENV: "local" },
    });
    expect(slugs(visible)).toEqual(["il"]);
  });

  it("drops an illustrative row under MOP_ENV production even when the setting is on", () => {
    const visible = applyVisibility(rows(["il", "california", "Illustrative"]), {
      state: stateOf({ illustrativeContent: true }),
      env: { MOP_ENV: "production" },
    });
    expect(visible.properties).toEqual([]);
  });

  it("drops an illustrative row when the setting is off, as public_state() gives for a missing environment", () => {
    const visible = applyVisibility(
      rows(["il", "california", "Illustrative"], ["ok", "california", "Active"]),
      { state: stateOf({ illustrativeContent: false }), env: { MOP_ENV: "local" } },
    );
    expect(slugs(visible)).toEqual(["ok"]);
  });

  it("leaves markets and stories as they are", () => {
    const visible = applyVisibility(rows(["ca", "california", "Active"]), {
      state: stateOf({ comingSoonGlobal: true }),
      env: { MOP_ENV: "preview" },
    });
    expect(visible.markets).toBe(base.markets);
    expect(visible.stories).toBe(base.stories);
  });
});
