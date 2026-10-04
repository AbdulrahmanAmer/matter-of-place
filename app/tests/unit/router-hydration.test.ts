// src/router.tsx (B3 step 12, F25 f): the query cache the server render filled reaches the browser's
// router, so a page load causes no second catalog request.
import "../fixtures/worker-env";
import { describe, expect, it, vi } from "vitest";
import { propertiesQuery } from "../../src/lib/queries";
import { getRouter } from "../../src/router";
import { services } from "../../src/services";

async function dehydratedRender() {
  const cards = await services.catalog.listProperties();
  const server = getRouter();
  server.options.context.queryClient.setQueryData(propertiesQuery().queryKey, cards);
  const state = await server.options.dehydrate?.();
  if (state === undefined) throw new Error("the router has no dehydrate option");
  return { cards, state };
}

describe("router hydration", () => {
  it("fills the browser's query cache from the server's dehydrated state", async () => {
    const { cards, state } = await dehydratedRender();
    const browser = getRouter();
    await browser.options.hydrate?.(state);
    expect(browser.options.context.queryClient.getQueryData(propertiesQuery().queryKey)).toEqual(
      cards,
    );
  });

  it("serves a hydrated query without calling the catalog again", async () => {
    const { cards, state } = await dehydratedRender();
    const browser = getRouter();
    await browser.options.hydrate?.(state);
    const listProperties = vi.spyOn(services.catalog, "listProperties");
    const answer = await browser.options.context.queryClient.ensureQueryData(propertiesQuery());
    expect({ answer, calls: listProperties.mock.calls.length }).toEqual({
      answer: cards,
      calls: 0,
    });
  });

  it("gives each router its own query client", () => {
    expect(getRouter().options.context.queryClient).not.toBe(
      getRouter().options.context.queryClient,
    );
  });
});
