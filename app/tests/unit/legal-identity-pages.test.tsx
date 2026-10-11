// Panel findings 1, 19, 9, 10 and 11, read from what the pages render: the footer and the four legal pages name
// Omnikom LLC and its address while the settings rows are empty, the home headline is said once, /terms states the
// editorial review time itself and /contact addresses owners and agents.
import "../fixtures/worker-env";
import type { ComponentType } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Footer } from "../../src/components/layout/footer";
import { siteConfig } from "../../src/config/site";
import { properties } from "../../src/data/properties";
import { markets } from "../../src/data/markets";
import { emptySiteSettings, type PublicSite } from "../../src/domain/settings";
import { Route as contactRoute } from "../../src/routes/_site.contact";
import { Route as cookiesRoute } from "../../src/routes/_site.cookies";
import { Route as homeRoute } from "../../src/routes/_site.index";
import { Route as legalRoute } from "../../src/routes/_site.legal";
import { Route as privacyRoute } from "../../src/routes/_site.privacy";
import { Route as termsRoute } from "../../src/routes/_site.terms";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const EMPTY: PublicSite = { ...emptySiteSettings, illustrativeContent: false, products: [] };
const SET: PublicSite = {
  ...EMPTY,
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
};

/** Renders a component at "/" under a root whose loader answers with `site`, as `__root__.tsx` does. */
async function show(Page: ComponentType, site: PublicSite) {
  const root = createRootRoute({ loader: () => site, component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: "/", component: () => <Page /> });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(document.body.textContent).not.toBe("");
  });
}

function pageOf(route: { options: { component?: ComponentType | undefined } }): ComponentType {
  const Page = route.options.component;
  if (Page === undefined) throw new Error("the route has no component");
  return Page;
}

const surfaces = [
  ["the footer", Footer],
  ["/terms", pageOf(termsRoute)],
  ["/privacy", pageOf(privacyRoute)],
  ["/legal", pageOf(legalRoute)],
  ["/cookies", pageOf(cookiesRoute)],
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the surfaces that name the company (findings 1 and 19)", () => {
  it.each(surfaces)(
    "%s names Omnikom LLC and its Sheridan address with empty settings",
    async (_n, Page) => {
      await show(Page, EMPTY);
      const text = document.body.textContent;
      expect(text).toContain("Omnikom LLC");
      expect(text).toContain("Sheridan, WY 82801");
      expect(text).toContain(siteConfig.legalAddress);
    },
  );

  it.each(surfaces)(
    "%s prints the saved entity and address instead when they are set",
    async (_n, Page) => {
      await show(Page, SET);
      const text = document.body.textContent;
      expect(text).toContain("Example Test LLC");
      expect(text).toContain("1 Test Street, Testville, CA 90000");
      expect(text).not.toContain("Sheridan");
    },
  );

  it("/terms and /cookies open with a Who we are section that names both", async () => {
    for (const route of [termsRoute, cookiesRoute]) {
      await show(pageOf(route), EMPTY);
      const first = screen.getAllByRole("heading", { level: 2 })[0];
      expect(first?.textContent).toBe("Who we are");
      const intro = first?.nextElementSibling?.textContent ?? "";
      expect(intro).toContain("Omnikom LLC");
      expect(intro).toContain("30 N Gould St Ste R, Sheridan, WY 82801, USA");
      cleanup();
    }
  });

  it("/privacy says in Who is responsible that Omnikom LLC is the party and gives its address", async () => {
    await show(pageOf(privacyRoute), EMPTY);
    const heading = screen.getByRole("heading", { name: "Who is responsible" });
    const text = heading.nextElementSibling?.textContent ?? "";
    expect(text).toContain("Omnikom LLC is responsible for the personal information");
    expect(text).toContain("30 N Gould St Ste R, Sheridan, WY 82801, USA");
    expect(text).toContain("Matter of Place is a product of Omnikom LLC.");
  });

  it("the footer reads A product of Omnikom LLC and the legal line carries the entity and address", async () => {
    await show(Footer, EMPTY);
    const bottom = document.querySelector(".footer-bottom")?.textContent ?? "";
    expect(bottom).toContain("Matter of Place · A product of Omnikom LLC.");
    expect(bottom).toMatch(/© \d{4}\s*Omnikom LLC/);
    expect(bottom).toContain("30 N Gould St Ste R, Sheridan, WY 82801, USA");
  });

  it("the words added for it have no dash, no exclamation mark and no hyperbole", async () => {
    const added: string[] = [];
    for (const route of [termsRoute, cookiesRoute, privacyRoute]) {
      await show(pageOf(route), EMPTY);
      const heading = screen.getAllByRole("heading", { level: 2 })[0];
      added.push(heading?.nextElementSibling?.textContent ?? "");
      cleanup();
    }
    expect(added.filter((text) => /[–—!]/.test(text))).toEqual([]);
    expect(
      added.filter((text) => /exclusive|guarantee|stunning|luxury|world-class|dream/i.test(text)),
    ).toEqual([]);
    expect(added.every((text) => text.length > 40 && text.length < 400)).toBe(true);
  });
});

describe("the home headline (finding 9)", () => {
  const card = properties[0];
  const market = markets[0];
  if (card === undefined || market === undefined) throw new Error("no bundled data");

  function home(hero: (typeof card)[]) {
    vi.spyOn(homeRoute, "useLoaderData").mockReturnValue({
      hero,
      featured: [],
      preview: [],
      markets: [market],
      site: EMPTY,
    });
    return show(pageOf(homeRoute), EMPTY);
  }
  const said = () =>
    screen
      .queryAllByRole("heading")
      .filter((heading) => heading.textContent === siteConfig.tagline);

  it("with no hero, the coming-soon page says the headline once and the eyebrow once", async () => {
    await home([]);
    expect(said().map((heading) => heading.tagName)).toEqual(["H1"]);
    expect(screen.getAllByText("MATTER OF PLACE")).toHaveLength(1);
    expect(screen.getByText(/An editorial real-estate media platform/)).toBeTruthy();
  });

  it("with a hero, the editorial statement keeps its headline and eyebrow", async () => {
    await home([{ ...card, heroRank: 1 }]);
    expect(said().map((heading) => heading.tagName)).toEqual(["H2"]);
    expect(screen.getAllByText("MATTER OF PLACE")).toHaveLength(1);
  });
});

describe("the review time on /terms (finding 10)", () => {
  it("is stated in the Submitting a property section, with no link to /exposure", async () => {
    await show(pageOf(termsRoute), EMPTY);
    const section = screen.getByRole("heading", {
      name: "Submitting a property",
    }).nextElementSibling;
    expect(section?.textContent).toContain(
      "Editorial review usually takes up to five business days",
    );
    expect(section?.querySelector('a[href="/exposure"]')).toBeNull();
    expect(section?.textContent).not.toMatch(/guarantee|within/i);
  });
});

describe("who the contact page addresses (finding 11)", () => {
  it("says owners and agents and never developers", async () => {
    await show(pageOf(contactRoute), EMPTY);
    expect(screen.getByText("OWNERS AND AGENTS")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/developer/i);
  });
});
