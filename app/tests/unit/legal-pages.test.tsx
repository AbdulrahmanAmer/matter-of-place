// B16 step 4: the footer, /legal and /contact print what `settings.site` holds and nothing else, /legal states the
// illustrative-content paragraph only where it is true, and the two inquiry forms say who receives the message.
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
import { describe, expect, it } from "vitest";
import { ContactForm } from "../../src/components/forms/contact-form";
import { InquiryDialog } from "../../src/components/forms/inquiry-dialog";
import { Footer } from "../../src/components/layout/footer";
import { siteConfig } from "../../src/config/site";
import type { PublicSite } from "../../src/domain/settings";
import { t } from "../../src/lib/strings";
import { Route as contactRoute } from "../../src/routes/_site.contact";
import { Route as legalRoute } from "../../src/routes/_site.legal";

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

/** The root loader answers with `site`, as `__root__.tsx` does with `siteQuery()`; `Page` renders in its place. */
async function renderPage(Page: ComponentType, site: PublicSite) {
  const rootRoute = createRootRoute({ loader: () => site, component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Page />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory(),
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
