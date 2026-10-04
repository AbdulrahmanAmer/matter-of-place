// G55: a card draws a photograph only when it has one, and a market that is coming soon draws none (S43).
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { MarketCard } from "../../src/components/site/market-card";
import { StoryCard } from "../../src/components/site/story-card";
import { markets } from "../../src/data/markets";
import { stories } from "../../src/data/stories";
import { t } from "../../src/lib/strings";

const baseMarket = markets[0];
const baseStory = stories[0];
if (baseMarket === undefined || baseStory === undefined) throw new Error("no bundled data");
const open = { ...baseMarket, comingSoon: false };
const photo = "/photo.jpg";

async function renderInRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory(),
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("link");
  return view.container;
}

describe("MarketCard", () => {
  it("draws no img without an image", async () => {
    const container = await renderInRouter(<MarketCard market={{ ...open, image: undefined }} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("draws one img and no illustrative word", async () => {
    const container = await renderInRouter(<MarketCard market={{ ...open, image: photo }} />);
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("alt")).toBe(`${open.name} architecture`);
  });

  it("draws no img while coming soon and shows the badge", async () => {
    const container = await renderInRouter(
      <MarketCard market={{ ...open, image: photo, comingSoon: true }} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText(t.comingSoon.badge)).toBeTruthy();
    expect(screen.getByText(t.comingSoon.cardLine)).toBeTruthy();
  });
});

describe("StoryCard", () => {
  it("draws no img without an image", async () => {
    const container = await renderInRouter(
      <StoryCard story={{ ...baseStory, image: undefined }} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("draws one img with an image", async () => {
    const container = await renderInRouter(<StoryCard story={{ ...baseStory, image: photo }} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});
