// B18 step 3: the Exposure page, the home pricing block and /faq render the plans they are given, and a price changed
// in `settings.products` reaches every one of them through `getPublicSite`, the read the root loader makes.
import "../fixtures/worker-env";
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { properties } from "../../src/data/properties";
import type { ProductPlan } from "../../src/domain/exposure";
import { emptySiteSettings } from "../../src/domain/settings";
import { Route as ExposureRoute } from "../../src/routes/_site.exposure";
import { Route as FaqRoute } from "../../src/routes/_site.faq";
import { Route as HomeRoute } from "../../src/routes/_site.index";
import { getPublicSite } from "../../src/server/settings/service";
import { seedProducts } from "../../src/server/settings/products";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

const card = properties[0];
if (card === undefined) throw new Error("no bundled property");

/** The seed with The Feature at $325 and Five Features at $1,300, as an admin would store it. */
const changed = (): ProductPlan[] =>
  seedProducts().map((plan) => {
    if (plan.id === "feature") return { ...plan, price: 325 };
    if (plan.id === "five-features") return { ...plan, price: 1300 };
    return plan;
  });

async function renderInRouter(node: ReactNode): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory(),
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findAllByRole("link");
  return view.container.textContent;
}

function pageOf(Page: (typeof HomeRoute)["options"]["component"]) {
  if (Page === undefined) throw new Error("route has no component");
  return <Page />;
}

function renderHome(plans: ProductPlan[]): Promise<string> {
  vi.spyOn(HomeRoute, "useLoaderData").mockReturnValue({
    hero: [card],
    featured: [],
    preview: [],
    markets: [],
    site: { ...emptySiteSettings, illustrativeContent: false, products: plans },
  });
  return renderInRouter(pageOf(HomeRoute.options.component));
}

function renderExposure(plans: ProductPlan[]): Promise<string> {
  vi.spyOn(ExposureRoute, "useLoaderData").mockReturnValue(plans);
  return renderInRouter(pageOf(ExposureRoute.options.component));
}

function renderFaq(plans: ProductPlan[]): Promise<string> {
  vi.spyOn(FaqRoute, "useLoaderData").mockReturnValue(plans);
  return renderInRouter(pageOf(FaqRoute.options.component));
}

/** The JSON-LD the route's `head` builds from its loader data. */
function headOf(route: { options: { head?: unknown } }, plans: ProductPlan[]): string {
  const { head } = route.options;
  if (typeof head !== "function") throw new Error("route has no head");
  return JSON.stringify(Reflect.apply(head, undefined, [{ loaderData: plans, matches: [] }]));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Exposure page", () => {
  it("renders the plans it is given, and the Five Features answer quotes the price of that plan", async () => {
    const text = await renderExposure(changed());
    expect(text).toContain("$325");
    expect(text).not.toContain("$295");
    expect(text).toContain("Five Feature credits are available for $1,300.");
    expect(headOf(ExposureRoute, changed())).toContain("available for $1,300.");
  });
});

describe("the product names by page (MET-003)", () => {
  it("/exposure names each plan in an h2, as nothing above the cards is a heading, and the home block keeps h3 under its h2", async () => {
    await renderExposure(changed());
    const names = changed().map((plan) => plan.name);
    const at = (level: number) =>
      screen.getAllByRole("heading", { level }).map((node) => node.textContent);
    expect(at(2)).toEqual(expect.arrayContaining(names));
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
    cleanup();
    await renderHome(changed());
    const pricing = within(screen.getByRole("region", { name: "Four ways in." }));
    expect(pricing.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(
      names,
    );
  });
});

describe("the home pricing block", () => {
  it("renders the plans it is given, titled Four ways in. for the four stored plans", async () => {
    const text = await renderHome(changed());
    expect(screen.getByRole("heading", { level: 2, name: "Four ways in." })).toBeDefined();
    expect(text).toContain("$325");
    expect(text).not.toContain("$295");
  });

  it("titles a three-plan prop Three ways in. and shows three cards", async () => {
    await renderHome(seedProducts().slice(0, 3));
    expect(screen.getByRole("heading", { level: 2, name: "Three ways in." })).toBeDefined();
    const exposure = within(screen.getByRole("region", { name: "Three ways in." }));
    expect(exposure.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      "The Feature",
      "The Reach",
      "The Campaign",
    ]);
  });
});

describe("/faq", () => {
  it("answers What does it cost? with every price it is given", async () => {
    const text = await renderFaq(changed());
    expect(text).toContain(
      "The Feature $325, The Reach $695, The Campaign $1,495, or Five Features for $1,300.",
    );
    expect(headOf(FaqRoute, changed())).toContain("The Feature $325");
  });
});

describe("a price changed in settings.products", () => {
  it("changes every surface through the site read", async () => {
    const db = fakeDb({
      rpc: { public_state: () => stateJson(9, { products: { plans: changed() } }) },
    });
    const site = await getPublicSite(db, undefined, { env: { MOP_ENV: "local" } });
    const surfaces = [
      await renderExposure(site.products),
      await renderHome(site.products),
      await renderFaq(site.products),
    ];
    expect(surfaces.map((text) => text.includes("$325") && !text.includes("$295"))).toEqual([
      true,
      true,
      true,
    ]);
  });
});
