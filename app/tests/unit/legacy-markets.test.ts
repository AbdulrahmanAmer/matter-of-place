import "../fixtures/worker-env";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { legacyMarketTarget } from "../../src/lib/legacy-markets";
import { getRouter } from "../../src/router";

/** The redirect the router holds after it loads a `/markets/...` address. */
async function redirectOf(path: string) {
  const router = getRouter();
  router.update({
    context: router.options.context,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.redirect;
}

/** One slash, then not a second slash or a backslash: no scheme, no host. */
const sameOrigin = /^\/(?![/\\])/;

describe("legacyMarketTarget", () => {
  it("moves a desk address to the same path without /markets", () => {
    expect(legacyMarketTarget("california")).toBe("/california");
    expect(legacyMarketTarget("california/la-jolla")).toBe("/california/la-jolla");
    expect(legacyMarketTarget(undefined)).toBe("/");
  });

  it.each(["/evil.example", "//evil.example", "\\evil.example", "/\\evil.example/login", "///a"])(
    "never leaves the origin for the splat %j",
    (splat) => {
      const target = legacyMarketTarget(splat);
      expect(target).toMatch(sameOrigin);
      expect(target).not.toContain("//");
      expect(target).not.toContain("\\");
    },
  );

  it("sends a dot segment or a control character to the home page", () => {
    expect(legacyMarketTarget("a/../b")).toBe("/");
    expect(legacyMarketTarget("./b")).toBe("/");
    expect(legacyMarketTarget("\t/evil.example")).toBe("/");
    expect(legacyMarketTarget("ok/\nevil")).toBe("/");
  });
});

describe("the /markets/* route", () => {
  it("redirects a desk address permanently to the desk", async () => {
    const redirected = await redirectOf("/markets/california");
    expect({ href: redirected?.options.href, statusCode: redirected?.status }).toEqual({
      href: "/california",
      statusCode: 301,
    });
  });

  it.each(["/markets/%5Cevil.example", "/markets//evil.example", "/markets/%5C%5Cevil.example"])(
    "redirects %s to a path on this origin",
    async (path) => {
      const href = (await redirectOf(path))?.options.href;
      expect(href).toBeDefined();
      expect(href).toMatch(sameOrigin);
    },
  );
});
