// SEO home links: the home page names the 18 landing pages and guides in a quiet list near its foot, each link's
// visible text the anchor the SEO gate matches, each address a page the site serves.
import "../fixtures/worker-env";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { properties } from "../../src/data/properties";
import { seoPageMeta } from "../../src/content/seo/meta";
import { emptySiteSettings } from "../../src/domain/settings";
import { Route as HomeRoute } from "../../src/routes/_site.index";

const card = properties[0];
if (card === undefined) throw new Error("no bundled property");

const kindsOfHome = [
  ["/mid-century-modern-homes", "mid-century modern homes"],
  ["/historic-homes-for-sale", "historic homes for sale"],
  ["/frank-lloyd-wright-homes", "frank lloyd wright homes"],
  ["/architect-designed-homes-for-sale", "architect designed homes for sale"],
  ["/hudson-valley-stone-houses-for-sale", "hudson valley stone houses for sale"],
  ["/modern-homes-for-sale-south-florida", "modern homes for sale south florida"],
  ["/modernist-homes-for-sale-california", "modernist homes for sale california"],
  ["/richard-neutra-homes-for-sale", "richard neutra homes for sale"],
  ["/design-focused-homes-for-sale-newsletter", "design focused homes for sale newsletter"],
];

const forOwnersAndAgents = [
  ["/submit-a-home-for-sale-to-be-featured", "submit a home for sale to be featured"],
  ["/guides/real-estate-marketing", "real estate marketing"],
  [
    "/guides/is-a-sponsored-real-estate-feature-worth-it",
    "is a sponsored real estate feature worth it",
  ],
  ["/guides/house-of-the-day", "house of the day"],
  ["/guides/how-to-market-a-luxury-listing", "how to market a luxury listing"],
  ["/guides/how-to-sell-a-historic-home", "how to sell a historic home"],
  [
    "/guides/how-to-sell-an-architecturally-significant-home",
    "how to sell an architecturally significant home",
  ],
  ["/guides/sponsored-real-estate-listing", "sponsored real estate listing"],
  ["/guides/where-to-advertise-luxury-listings", "where to advertise luxury listings"],
];

async function renderHome(): Promise<HTMLElement> {
  vi.spyOn(HomeRoute, "useLoaderData").mockReturnValue({
    hero: [card],
    featured: [],
    preview: [],
    markets: [],
    marketIndex: [],
    site: { ...emptySiteSettings, illustrativeContent: false, products: [] },
  });
  const Page = HomeRoute.options.component;
  if (Page === undefined) throw new Error("route has no component");
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Page /> }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole("region", { name: "Plain writing on the homes we follow." });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the guides list on the home page", () => {
  it("links the 18 pages by their paths, each with its anchor as the visible text", async () => {
    const section = await renderHome();
    const links = within(section).getAllByRole("link");
    const pairs = links
      .filter((link) => link.textContent !== "All guides")
      .map((link) => [link.getAttribute("href"), link.textContent]);
    expect(pairs).toEqual([...kindsOfHome, ...forOwnersAndAgents]);
    expect(pairs).toHaveLength(18);
  });

  it("names a page the site serves at every path, and ends with All guides to /guides", async () => {
    const section = await renderHome();
    const served = new Set(seoPageMeta.map((page) => page.path));
    for (const [path] of [...kindsOfHome, ...forOwnersAndAgents]) {
      expect(served.has(path ?? "")).toBe(true);
    }
    const all = within(section).getByRole("link", { name: "All guides" });
    expect(all.getAttribute("href")).toBe("/guides");
  });

  it("keeps the heading order: one h2, then the two lists under h3, and no new h1", async () => {
    const section = await renderHome();
    const headings = within(section).getAllByRole("heading");
    expect(headings.map((node) => [node.tagName, node.textContent])).toEqual([
      ["H2", "Plain writing on the homes we follow."],
      ["H3", "Kinds of home"],
      ["H3", "For owners and agents"],
    ]);
    expect(within(section).getAllByRole("list")).toHaveLength(2);
  });

  it("sits after the editorial standard and before the closing submit band", async () => {
    const section = await renderHome();
    const main = section.closest("main");
    if (main === null) throw new Error("the guides list is not inside main");
    const blocks = [...main.children];
    const at = blocks.indexOf(section);
    expect(at).toBeGreaterThan(0);
    expect(blocks[at + 1]?.classList.contains("home-submit")).toBe(true);
    expect(blocks.at(-1)?.classList.contains("home-submit")).toBe(true);
  });
});
