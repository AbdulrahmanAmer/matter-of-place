// Only an illustrative property carries the word: a published one, a story, a market and a plain hero never do (G70, S43).
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageHero } from "../../src/components/site/image-hero";
import { IllustrativeNotice } from "../../src/components/site/illustrative-notice";
import { MarketCard } from "../../src/components/site/market-card";
import { PropertyCard } from "../../src/components/site/property-card";
import { StoryCard } from "../../src/components/site/story-card";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import { Route as HomeRoute } from "../../src/routes/_site.index";
import { Route as PropertyRoute } from "../../src/routes/_site.property.$slug";
import { t } from "../../src/lib/strings";

const word = /illustrative/i;
const market = markets[0];
const story = stories[0];
const region = market?.regions[0];
const plain = properties.find(
  (property) => !word.test(JSON.stringify({ ...property, status: "Active" })),
);
if (market === undefined || story === undefined || region === undefined || plain === undefined) {
  throw new Error("no bundled data without the word");
}
const active = { ...plain, status: "Active" } as const;
const illustrative = { ...plain, status: "Illustrative" } as const;
const open = { ...market, comingSoon: false, image: "/photo.jpg" };

async function renderInRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory(),
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findAllByRole("link");
  return view.container.innerHTML;
}

function renderHome(status: "Active" | "Illustrative") {
  const card = { ...plain, status, heroRank: 1, featuredRank: 1 };
  vi.spyOn(HomeRoute, "useLoaderData").mockReturnValue({
    hero: [card],
    featured: [card],
    preview: status === "Illustrative" ? [card] : [],
    markets: [open],
  });
  const Page = HomeRoute.options.component;
  if (Page === undefined) throw new Error("home route has no component");
  return renderInRouter(<Page />);
}

function renderProperty(status: "Active" | "Illustrative") {
  vi.spyOn(PropertyRoute, "useLoaderData").mockReturnValue({
    property: { ...plain, status },
    market: open,
    region,
    related: [],
    facets: null,
  });
  const Page = PropertyRoute.options.component;
  if (Page === undefined) throw new Error("property route has no component");
  return renderInRouter(<Page />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PropertyCard", () => {
  it("carries no illustrative word when the property is Active", async () => {
    expect(await renderInRouter(<PropertyCard property={active} />)).not.toMatch(word);
  });

  it("carries the tag and the word in the alt when the property is Illustrative", async () => {
    const html = await renderInRouter(<PropertyCard property={illustrative} />);
    expect(html).toContain('class="content-tag"');
    expect(html).toContain(`alt="Illustrative architecture in ${plain.city}"`);
  });
});

describe("home hero", () => {
  it("carries no illustrative word when the property is Active", async () => {
    expect(await renderHome("Active")).not.toMatch(word);
  });

  it("carries the tag and the notice when the property is Illustrative", async () => {
    const html = await renderHome("Illustrative");
    expect(html).toContain("ILLUSTRATIVE PROPERTY");
    expect(html).toContain(t.comingSoon.illustrative.title);
  });
});

describe("property page hero", () => {
  it("carries no illustrative word when the property is Active", async () => {
    expect(await renderProperty("Active")).not.toMatch(word);
  });

  it("carries the tag when the property is Illustrative", async () => {
    expect(await renderProperty("Illustrative")).toContain("ILLUSTRATIVE PROPERTY");
  });
});

describe("labels that never carry the word", () => {
  it("StoryCard", async () => {
    expect(
      await renderInRouter(<StoryCard story={{ ...story, image: "/photo.jpg" }} />),
    ).not.toMatch(word);
  });

  it("MarketCard, open and coming soon", async () => {
    expect(await renderInRouter(<MarketCard market={open} />)).not.toMatch(word);
    expect(await renderInRouter(<MarketCard market={{ ...open, comingSoon: true }} />)).not.toMatch(
      word,
    );
  });

  it("ImageHero without a tag", () => {
    const { container } = render(
      <ImageHero image="/photo.jpg" alt="A house" eyebrow="GUIDE" title="California" />,
    );
    expect(container.innerHTML).not.toMatch(word);
  });
});

describe("IllustrativeNotice", () => {
  it("renders nothing for properties that are not Illustrative", () => {
    const { container } = render(<IllustrativeNotice properties={[active]} />);
    expect(container.innerHTML).toBe("");
  });
});
