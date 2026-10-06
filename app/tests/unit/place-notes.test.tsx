// The Place Notes page, where a confirm link lands (B5 step 7): the notice and the tracked event come from `?confirmed`
// after hydration, and the signup block is on the page whatever the query says.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../../src/lib/analytics";
import { t } from "../../src/lib/strings";
import { Route } from "../../src/routes/_site.place-notes";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

function renderAt(search: string) {
  window.history.pushState({}, "", `/place-notes${search}`);
  const Page = Route.options.component;
  if (Page === undefined) throw new Error("the place-notes route has no component");
  render(<Page />);
}

beforeEach(() => {
  vi.mocked(track).mockClear();
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("Place Notes page", () => {
  it("?confirmed=1 shows the confirmed notice and tracks newsletter_confirmed once", async () => {
    renderAt("?confirmed=1");
    expect((await screen.findByRole("status")).textContent).toBe(t.newsletter.confirmed);
    expect(vi.mocked(track).mock.calls).toEqual([["newsletter_confirmed"]]);
  });

  it("?confirmed=0 shows the failure notice and tracks nothing", async () => {
    renderAt("?confirmed=0");
    expect((await screen.findByRole("status")).textContent).toBe(t.newsletter.confirmFailed);
    expect(track).not.toHaveBeenCalled();
  });

  it("no query shows neither notice and renders the newsletter block", () => {
    renderAt("");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t.newsletter.title);
    expect(screen.getByText(t.newsletter.text)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t.common.emailAddress })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.common.subscribe })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
