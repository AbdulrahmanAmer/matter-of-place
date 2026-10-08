// B16 step 4: the footer, /legal and /contact print what `settings.site` holds and nothing else, /legal states the
// illustrative-content paragraph only where it is true, and the two inquiry forms say who receives the message.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ContactForm } from "../../src/components/forms/contact-form";
import { initialDraft } from "../../src/components/forms/submit/state";
import { ExposureStep } from "../../src/components/forms/submit/steps";
import { ConsentNotice } from "../../src/components/layout/consent-notice";
import { Footer } from "../../src/components/layout/footer";
import { InquiryDialog } from "../../src/components/forms/inquiry-dialog";
import { legalVersions, siteConfig } from "../../src/config/site";
import { currentRightsVersion } from "../../src/domain/contracts";
import { retentionPeriods } from "../../src/domain/retention";
import type { PublicSite } from "../../src/domain/settings";
import { t } from "../../src/lib/strings";
import { Route as accessibilityRoute } from "../../src/routes/_site.accessibility";
import { Route as contactRoute } from "../../src/routes/_site.contact";
import { Route as legalRoute } from "../../src/routes/_site.legal";
import { Route as privacyRoute } from "../../src/routes/_site.privacy";
import { Route as privacyChoicesRoute } from "../../src/routes/_site.privacy-choices";
import { Route as termsRoute } from "../../src/routes/_site.terms";
import { Route as sitemapRoute } from "../../src/routes/sitemap[.]xml";

const UNSET: PublicSite = {
  contact: { email: null, phone: null, privacy_email: null },
  legal: { entity: null, address: null },
  social: { instagram: null, x: null, linkedin: null },
  illustrativeContent: false,
};
const SET: PublicSite = {
  contact: { email: "hello@example.test", phone: "+1 555 010 0100", privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: {
    instagram: "https://www.instagram.com/exampletest",
    x: "https://x.com/exampletest",
    linkedin: "https://www.linkedin.com/company/exampletest",
  },
  illustrativeContent: false,
};
const noop = () => undefined;
const LINKS_OF_SET_VALUES =
  'a[href*="instagram.com"], a[href*="x.com"], a[href*="linkedin.com"], a[href^="mailto:"], a[href^="tel:"]';

/** The root loader answers with `site`, as `__root__.tsx` does with `siteQuery()`; each page renders at its path. */
async function renderAt(initial: string, pages: Record<string, ComponentType>, site: PublicSite) {
  const rootRoute = createRootRoute({ loader: () => site, component: Outlet });
  const children = Object.entries(pages).map(([path, Page]) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <Page /> }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(document.body.textContent).not.toBe("");
  });
  return router;
}

async function renderPage(Page: ComponentType, site: PublicSite) {
  await renderAt("/", { "/": Page }, site);
}

function pageOf(route: { options: { component?: ComponentType | undefined } }): ComponentType {
  const Page = route.options.component;
  if (Page === undefined) throw new Error("the route has no component");
  return Page;
}

const surfaces = [
  ["the footer", Footer],
  ["/legal", pageOf(legalRoute)],
  ["/contact", pageOf(contactRoute)],
] as const;

describe("the public pages that name the business", () => {
  it("an all-null site renders no null, no empty paragraph, no contact line and no social link", async () => {
    const problems: string[] = [];
    for (const [name, Page] of surfaces) {
      await renderPage(Page, UNSET);
      const body = document.body;
      if (/\bnull\b/.test(body.textContent)) problems.push(`${name}: the word null`);
      const empty = [...body.querySelectorAll("p")].filter((p) => p.textContent.trim() === "");
      if (empty.length > 0) problems.push(`${name}: ${String(empty.length)} empty paragraphs`);
      for (const link of body.querySelectorAll(LINKS_OF_SET_VALUES)) {
        problems.push(`${name}: link ${link.getAttribute("href") ?? ""}`);
      }
      cleanup();
    }
    expect(problems).toEqual([]);
  });

  it("an all-set site shows the entity, the address, the contact lines and the Instagram, X and LinkedIn links", async () => {
    await renderPage(Footer, SET);
    expect(screen.getByRole("link", { name: t.nav.instagram }).getAttribute("href")).toBe(
      SET.social.instagram,
    );
    expect(screen.getByRole("link", { name: t.nav.x }).getAttribute("href")).toBe(SET.social.x);
    expect(screen.getByRole("link", { name: t.nav.linkedin }).getAttribute("href")).toBe(
      SET.social.linkedin,
    );
    expect(screen.getByText(new RegExp(`© \\d{4} ${SET.legal.entity ?? ""}`))).toBeTruthy();
    cleanup();

    await renderPage(pageOf(legalRoute), SET);
    expect(screen.getByText(SET.legal.entity ?? "")).toBeTruthy();
    expect(screen.getByText(SET.legal.address ?? "")).toBeTruthy();
    cleanup();

    await renderPage(pageOf(contactRoute), SET);
    expect(screen.getByRole("link", { name: SET.contact.email ?? "" }).getAttribute("href")).toBe(
      `mailto:${SET.contact.email ?? ""}`,
    );
    expect(screen.getByRole("link", { name: SET.contact.phone ?? "" }).getAttribute("href")).toBe(
      "tel:+15550100100",
    );
  });
});

describe("/legal", () => {
  const paragraph = /Every property, story, price, representative reference and photograph/;

  it("shows the illustrative paragraph when illustrativeContent is true", async () => {
    await renderPage(pageOf(legalRoute), { ...UNSET, illustrativeContent: true });
    expect(screen.getByRole("heading", { name: "Illustrative content" })).toBeTruthy();
    expect(screen.getByText(paragraph)).toBeTruthy();
  });

  it("leaves it out when illustrativeContent is false", async () => {
    await renderPage(pageOf(legalRoute), { ...UNSET, illustrativeContent: false });
    expect(screen.queryByRole("heading", { name: "Illustrative content" })).toBeNull();
    expect(screen.queryByText(paragraph)).toBeNull();
  });
});

describe("the inquiry forms", () => {
  const above = (note: HTMLElement) =>
    note.nextElementSibling?.querySelector('button[type="submit"]');

  it("the contact form renders forms.sharedWithOmnikom directly above the send button", () => {
    render(<ContactForm />);
    expect(above(screen.getByText(t.forms.sharedWithOmnikom))).toBeTruthy();
  });

  it("the inquiry dialog renders forms.sharedWithOmnikom directly above the send button", () => {
    render(<InquiryDialog intent="ask" onClose={noop} />);
    expect(above(screen.getByText(t.forms.sharedWithOmnikom))).toBeTruthy();
  });
});

describe("the parent company", () => {
  it("t.footer.line names siteConfig.parentCompany and /legal says Matter of Place is a product of Omnikom.", async () => {
    expect(t.footer.line).toBe(`A product of ${siteConfig.parentCompany}.`);
    await renderPage(Footer, UNSET);
    expect(screen.getByText(new RegExp(`${t.footer.line}$`))).toBeTruthy();
    cleanup();
    await renderPage(pageOf(legalRoute), UNSET);
    expect(screen.getByText("Matter of Place is a product of Omnikom.")).toBeTruthy();
  });
});

const mainText = () => screen.getByRole("main").textContent;
const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

const sections = {
  privacy: [
    "Who is responsible",
    "What we collect",
    "Where it comes from",
    "How we use it",
    "Who receives it",
    "How long we keep it",
    "Cookies and analytics",
    "Your California privacy rights",
    "Do Not Sell or Share My Personal Information",
    "Children",
    "Changes to this policy",
    "Contact",
  ],
  terms: [
    "Using this site",
    "Accuracy of property information",
    "Editorial independence",
    "Submitting a property",
    "Rights to photographs",
    "Removal requests",
    "Fees and payment",
    "Refunds",
    "No promise of results",
    "Changes to these terms",
    "Contact",
  ],
  accessibility: [
    "Our commitment",
    "What we do",
    "How we check",
    "Known limits",
    "Tell us about a problem",
    "Last updated",
  ],
};

describe("the legal pages", () => {
  it.each([
    ["/privacy", privacyRoute, sections.privacy, "Privacy"],
    ["/terms", termsRoute, sections.terms, "Terms for Professionals"],
    ["/accessibility", accessibilityRoute, sections.accessibility, "Accessibility"],
  ] as const)("%s has its h1 and its h2 sections in order", async (_path, route, h2s, h1) => {
    await renderPage(pageOf(route), UNSET);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(h1);
    expect(headings()).toEqual(h2s);
  });

  it("an unset site leaves no null and no empty paragraph on any of the three", async () => {
    for (const route of [privacyRoute, termsRoute, accessibilityRoute]) {
      await renderPage(pageOf(route), UNSET);
      const withNull = [...document.querySelectorAll("main *")].filter((el) =>
        /\bnull\b/.test(el.textContent),
      );
      expect(withNull).toEqual([]);
      expect(
        [...document.querySelectorAll("p")].filter((p) => p.textContent.trim() === ""),
      ).toEqual([]);
      cleanup();
    }
  });

  it("/privacy has the do-not-sell anchor and /terms the rights-to-photographs anchor", async () => {
    await renderPage(pageOf(privacyRoute), UNSET);
    expect(document.getElementById("do-not-sell")?.textContent).toBe(
      "Do Not Sell or Share My Personal Information",
    );
    cleanup();
    await renderPage(pageOf(termsRoute), UNSET);
    expect(document.getElementById("rights-to-photographs")?.textContent).toBe(
      "Rights to photographs",
    );
  });

  it("the page titles carry the brand once", async () => {
    for (const route of [privacyRoute, termsRoute, accessibilityRoute]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- these heads read no argument
      const head = await route.options.head?.({} as never);
      const title = head?.meta?.find((tag) => tag?.title !== undefined)?.title;
      expect(title?.split(siteConfig.name)).toHaveLength(2);
      expect(title?.endsWith(` | ${siteConfig.name}`)).toBe(true);
    }
  });

  it("/privacy prints each retention period as retentionPeriods holds it", async () => {
    await renderPage(pageOf(privacyRoute), UNSET);
    const rows = [...document.querySelectorAll<HTMLElement>("tr[data-retention]")];
    expect(rows.map((row) => row.dataset["retention"]).sort()).toEqual(
      Object.keys(retentionPeriods).sort(),
    );
    for (const [key, period] of Object.entries(retentionPeriods)) {
      const [entry]: [string, number][] = Object.entries(period);
      const [unit, count] = entry ?? ["", 0];
      const word = count === 1 ? unit.replace(/s$/, "") : unit;
      const shown = rows.find((row) => row.dataset["retention"] === key)?.querySelector("td");
      expect([key, shown?.textContent]).toEqual([key, `${String(count)} ${word}`]);
    }
  });

  it("/privacy limits the hours to rate-limit records and says a hash on a record stays with it", async () => {
    await renderPage(pageOf(privacyRoute), UNSET);
    const row = screen.getByRole("rowheader", { name: "Identifiers" }).closest("tr");
    const kept = row?.querySelectorAll("td")[3]?.textContent ?? "";
    const hours = `${String(retentionPeriods.rate_limits.hours)} hours`;
    expect(kept.split(hours)).toHaveLength(2);
    expect(kept).toContain(`rate-limit records after ${hours}`);
    expect(kept).toContain("stays with that record");
  });

  it("the terms text matches the hash recorded for legalVersions.terms", async () => {
    const file = resolve(import.meta.dirname, "fixtures/legal-hashes.json");
    const recorded = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(file, "utf8")));
    await renderPage(pageOf(termsRoute), UNSET);
    const hash = createHash("sha256").update(mainText()).digest("hex");
    expect(hash).toBe(recorded[legalVersions.terms]);
  });

  it("currentRightsVersion equals legalVersions.terms", () => {
    expect(currentRightsVersion).toBe(legalVersions.terms);
  });

  it("the submit wizard's rights step links /terms#rights-to-photographs", async () => {
    await renderPage(() => <ExposureStep draft={initialDraft} update={noop} />, UNSET);
    expect(hrefOf(t.nav.terms)).toBe("/terms#rights-to-photographs");
  });

  it("/privacy links /cookies", async () => {
    await renderPage(pageOf(privacyRoute), UNSET);
    expect(hrefOf(t.privacy.cookiesLink)).toBe("/cookies");
  });

  it("the footer links Privacy, Terms for Professionals, Accessibility and Do Not Sell or Share", async () => {
    await renderPage(Footer, UNSET);
    expect([
      hrefOf(t.nav.privacy),
      hrefOf(t.nav.terms),
      hrefOf(t.nav.accessibility),
      hrefOf(t.nav.doNotSell),
    ]).toEqual(["/privacy", "/terms", "/accessibility", "/privacy#do-not-sell"]);
  });

  it("the consent notice, mounted with no stored choice, links /privacy", async () => {
    await renderPage(ConsentNotice, UNSET);
    expect((await screen.findByRole("link", { name: t.consent.link })).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("/privacy-choices links /privacy and not /legal#privacy", async () => {
    await renderPage(pageOf(privacyChoicesRoute), UNSET);
    expect(hrefOf(t.consent.link)).toBe("/privacy");
    expect(document.querySelector('a[href="/legal#privacy"]')).toBeNull();
  });
});

describe("the sitemap", () => {
  it("holds /privacy, /terms and /accessibility and not /privacy-request", async () => {
    const handlers = sitemapRoute.options.server?.handlers;
    const get = typeof handlers === "object" ? handlers["GET"] : undefined;
    if (typeof get !== "function") throw new Error("the sitemap route has no GET handler");
    const request = new Request(`${siteConfig.url}/sitemap.xml`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the handler reads no argument
    const response: unknown = await get({ request } as never);
    if (!(response instanceof Response)) throw new Error("the sitemap answered nothing");
    const body = await response.text();
    const paths = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${siteConfig.url}/privacy`,
        `${siteConfig.url}/terms`,
        `${siteConfig.url}/accessibility`,
      ]),
    );
    expect(paths).not.toContain(`${siteConfig.url}/privacy-request`);
  });
});

describe("the old /legal anchors", () => {
  const targets = { "/privacy": () => <p>privacy page</p>, "/terms": () => <p>terms page</p> };
  const legal = pageOf(legalRoute);
  afterEach(() => {
    window.location.hash = "";
  });

  it.each([
    ["#privacy", "/privacy"],
    ["#terms", "/terms"],
  ])("/legal with %s lands on %s", async (hash, path) => {
    window.location.hash = hash;
    const router = await renderAt("/legal", { "/legal": legal, ...targets }, UNSET);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
    expect(router.history.canGoBack()).toBe(false);
  });

  it("/legal with no hash stays on /legal", async () => {
    const router = await renderAt("/legal", { "/legal": legal, ...targets }, UNSET);
    expect(router.state.location.pathname).toBe("/legal");
  });
});
