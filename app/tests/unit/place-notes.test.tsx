// Place Notes (B5 step 7) and the thank-you note a confirm link lands on (operator, 2026-10-19).
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceNotesThanks } from "../../src/components/site/place-notes-thanks";
import { track } from "../../src/lib/analytics";
import { t } from "../../src/lib/strings";
import { Route } from "../../src/routes/_site.place-notes";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

async function renderInRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("link");
}

beforeEach(() => {
  vi.mocked(track).mockClear();
});

describe("Place Notes page", () => {
  it("renders the newsletter block and no notice", () => {
    const Page = Route.options.component;
    if (Page === undefined) throw new Error("the place-notes route has no component");
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t.newsletter.title);
    expect(screen.getByText(t.newsletter.text)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t.common.emailAddress })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.common.subscribe })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});

describe("the thank-you note", () => {
  it("confirmed: thanks, offers the stories and home, and tracks newsletter_confirmed once", async () => {
    await renderInRouter(<PlaceNotesThanks status="confirmed" />);
    expect([
      screen.getByRole("heading", { level: 1 }).textContent,
      screen.getByText(t.newsletter.thanks.confirmed.text).tagName,
      screen.getByRole("link", { name: t.newsletter.thanks.confirmed.action }).getAttribute("href"),
      screen.getByRole("link", { name: t.newsletter.thanks.home }).getAttribute("href"),
      vi.mocked(track).mock.calls,
    ]).toEqual([
      t.newsletter.thanks.confirmed.title,
      "P",
      "/stories",
      "/",
      [["newsletter_confirmed"]],
    ]);
  });

  it("expired: says so, sends the visitor back to subscribe, and tracks nothing", async () => {
    await renderInRouter(<PlaceNotesThanks status="expired" />);
    expect([
      screen.getByRole("heading", { level: 1 }).textContent,
      screen.getByRole("link", { name: t.newsletter.thanks.expired.action }).getAttribute("href"),
      vi.mocked(track).mock.calls,
    ]).toEqual([t.newsletter.thanks.expired.title, "/place-notes", []]);
  });
});
