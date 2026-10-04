// scripts/assert-coming-soon.mjs (B3b step 9), driven through a stub fetch that serves the five paths it reads.
import { describe, expect, it } from "vitest";
import { runChecks } from "../../scripts/assert-coming-soon.mjs";

const BASE = "https://matter-of-place.holy-meadow-4327.workers.dev";
const CARD = '<a class="property-card" href="/property/a-house">A house</a>';
const EMPTY = "<p>No property is listed in California yet.</p>";
const market = (slug: string, comingSoon: boolean) => ({ slug, comingSoon });

type Answer = { status: number; body: string } | Error;

const MARKETS = JSON.stringify([
  market("california", true),
  market("new-york", true),
  market("florida", true),
]);

function site(overrides: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    "/api/public/properties": { status: 200, body: "[]" },
    "/api/public/markets": { status: 200, body: MARKETS },
    "/": { status: 200, body: "<main><h2>The first properties are being considered.</h2></main>" },
    "/properties": { status: 200, body: "<main><h2>No property is listed yet.</h2></main>" },
    "/california": { status: 200, body: `<main>${EMPTY}</main>` },
    ...overrides,
  };
}

/** A published property and an open California, as after L1 step 7. */
const LAUNCHED = site({
  "/api/public/properties": { status: 200, body: JSON.stringify([{ slug: "a-house" }]) },
  "/api/public/markets": {
    status: 200,
    body: JSON.stringify([
      market("california", false),
      market("new-york", true),
      market("florida", true),
    ]),
  },
  "/": { status: 200, body: `<main>${CARD}</main>` },
  "/properties": { status: 200, body: `<main>${CARD}</main>` },
  "/california": { status: 200, body: `<main>${CARD}</main>` },
});

function checks(answers: Record<string, Answer>, afterLaunch: boolean): Promise<string[]> {
  return runChecks(BASE, {
    afterLaunch,
    fetch: (url: string) => {
      const answer = answers[new URL(url).pathname];
      if (answer === undefined) throw new Error(`unexpected request ${url}`);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(new Response(answer.body, { status: answer.status }));
    },
  });
}

describe("assert-coming-soon", () => {
  it("passes the coming-soon payload with and without --after-launch", async () => {
    expect([await checks(site(), false), await checks(site(), true)]).toEqual([[], []]);
  });

  it("after launch, a published property and an open market pass", async () => {
    expect(await checks(LAUNCHED, true)).toEqual([]);
  });

  it("before launch, a published property and an open market fail by name", async () => {
    expect(await checks(LAUNCHED, false)).toEqual([
      "properties",
      "markets",
      "property-card",
      "california",
    ]);
  });

  it("an ILLUSTRATIVE label on / fails no-illustrative in both modes", async () => {
    const labelled = site({
      "/": { status: 200, body: '<main><span class="content-tag">ILLUSTRATIVE</span></main>' },
    });
    expect([await checks(labelled, false), await checks(labelled, true)]).toEqual([
      ["no-illustrative"],
      ["no-illustrative"],
    ]);
  });

  it("a fetch error or a non-200 answer fails its check", async () => {
    const broken = site({
      "/api/public/markets": { status: 503, body: MARKETS },
      "/california": new Error("connect ECONNREFUSED"),
    });
    expect(await checks(broken, false)).toEqual(["markets", "california"]);
  });
});
