// The cookie notice (GP-02, ruling H85): a slim bar fixed to the bottom on every page but a property page, where it
// stays in the footer flow; never a dialog, never a question about necessary cookies, and a choice that can be changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "../../src/components/layout/footer";
import { Route as cookiesRoute } from "../../src/routes/_site.cookies";
import { Route as privacyChoicesRoute } from "../../src/routes/_site.privacy-choices";
import { track } from "../../src/lib/analytics";
import { CONSENT_VERSION, consentGranted, readConsent, writeConsent } from "../../src/lib/consent";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const css = readFileSync(join(process.cwd(), "src/styles/components/consent.css"), "utf8");

async function renderFooter(path = "/") {
  const router = createRouter({
    routeTree: createRootRoute({ component: Footer }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("link", { name: "Cookie settings" });
  return router;
}

const notice = () => screen.queryByRole("region", { name: "Cookie notice" });
const control = () => document.querySelector<HTMLAnchorElement>("#consent-change");

function store(version: number, analytics: boolean) {
  localStorage.setItem("mop_consent", JSON.stringify({ version, analytics }));
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "mop_consent=; Max-Age=0; Path=/";
  vi.mocked(track).mockClear();
});

afterEach(() => {
  document.documentElement.style.removeProperty("--consent-bar-h");
  Reflect.deleteProperty(navigator, "globalPrivacyControl");
  document.head.querySelectorAll("style").forEach((style) => {
    style.remove();
  });
});

describe("ConsentNotice", () => {
  it("shows a region named Cookie notice, no dialog and no focus taken, before any choice", async () => {
    await renderFooter();
    expect(await screen.findByRole("region", { name: "Cookie notice" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[autofocus]")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("Allow stores analytics true for this version, tracks consent_set and collapses", async () => {
    await renderFooter();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: true });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("consent_set", { analytics: true });
    expect(notice()).toBeNull();
  });

  it("No, thank you stores analytics false and collapses", async () => {
    await renderFooter();
    fireEvent.click(await screen.findByRole("button", { name: "No, thank you" }));
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: false });
    expect(track).toHaveBeenCalledWith("consent_set", { analytics: false });
    expect(notice()).toBeNull();
  });

  it("stays closed once decided, and Cookie settings in the footer opens it again without leaving the page", async () => {
    store(CONSENT_VERSION, false);
    const router = await renderFooter();
    expect(notice()).toBeNull();
    act(() => {
      control()?.click();
    });
    expect(await screen.findByRole("region", { name: "Cookie notice" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
  });

  it("closes when the choice is written elsewhere on the page, as on /privacy-choices", async () => {
    await renderFooter();
    expect(await screen.findByRole("region", { name: "Cookie notice" })).toBeTruthy();
    act(() => {
      writeConsent(false);
    });
    expect(notice()).toBeNull();
  });

  it("closes after a click even when the browser refuses to store the choice", async () => {
    const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is full");
    });
    await renderFooter();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }), { detail: 1 });
    expect(notice()).toBeNull();
    refuse.mockRestore();
  });

  it("leaves a modified click on Cookie settings to the browser: no reopen, the default is not prevented", async () => {
    store(CONSENT_VERSION, false);
    const router = await renderFooter();
    const kept = fireEvent.click(screen.getByRole("link", { name: "Cookie settings" }), {
      ctrlKey: true,
    });
    expect(kept).toBe(true);
    expect(notice()).toBeNull();
    expect(router.state.location.pathname).toBe("/");
  });

  it("stays closed once decided in a cookie alone, as a choice made without JavaScript leaves it", async () => {
    document.cookie = `mop_consent=${String(CONSENT_VERSION)}.0`;
    await renderFooter();
    expect(notice()).toBeNull();
  });

  it("asks again when the stored choice is from an older version", async () => {
    store(CONSENT_VERSION - 1, true);
    await renderFooter();
    expect(await screen.findByRole("region", { name: "Cookie notice" })).toBeTruthy();
  });

  it("moves focus to Cookie settings after a keyboard choice and not after a click", async () => {
    await renderFooter();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }), { detail: 1 });
    expect(document.activeElement).not.toBe(control());
    act(() => {
      control()?.click();
    });
    fireEvent.click(await screen.findByRole("button", { name: "No, thank you" }), { detail: 0 });
    expect(document.activeElement).toBe(control());
    expect(document.activeElement?.id).toBe("consent-change");
    expect(control()?.getAttribute("href")).toBe("/privacy-choices");
  });

  it("with Global Privacy Control on, Allow is stored and consent is still not granted", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    await renderFooter();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: true });
    expect(consentGranted()).toBe(false);
  });

  it("is a bar fixed to the bottom of the screen on a page that is not a property page", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    await renderFooter("/about");
    const region = await screen.findByRole("region", { name: "Cookie notice" });
    expect(region.classList.contains("consent-bar")).toBe(true);
    expect(getComputedStyle(region).position).toBe("fixed");
  });

  it("stays in the footer flow on a property page, never fixed or sticky", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    await renderFooter("/property/oak-hill-residence");
    const region = await screen.findByRole("region", { name: "Cookie notice" });
    expect(region.classList.contains("consent-bar")).toBe(false);
    expect(["fixed", "sticky"]).not.toContain(getComputedStyle(region).position);
  });

  it("publishes its height as --consent-bar-h only while the bar shows", async () => {
    const root = document.documentElement;
    await renderFooter("/about");
    await screen.findByRole("region", { name: "Cookie notice" });
    expect(root.style.getPropertyValue("--consent-bar-h")).not.toBe("");
    fireEvent.click(await screen.findByRole("button", { name: "No, thank you" }));
    expect(root.style.getPropertyValue("--consent-bar-h")).toBe("");
  });

  it("publishes no height on a property page, where the notice is in flow", async () => {
    await renderFooter("/property/oak-hill-residence");
    await screen.findByRole("region", { name: "Cookie notice" });
    expect(document.documentElement.style.getPropertyValue("--consent-bar-h")).toBe("");
  });

  it("asks only about analytics: no toggle, checkbox or switch, and no word about necessary cookies", async () => {
    await renderFooter("/about");
    const region = await screen.findByRole("region", { name: "Cookie notice" });
    expect(within(region).queryAllByRole("checkbox")).toEqual([]);
    expect(within(region).queryAllByRole("switch")).toEqual([]);
    expect(region.querySelectorAll('input, [role="checkbox"], [role="switch"]')).toHaveLength(0);
    expect(
      within(region)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Allow", "No, thank you"]);
    expect(region.textContent.toLowerCase()).not.toContain("necessary");
    expect(region.textContent).toContain("Google Analytics");
  });
});

describe("necessary cookies", () => {
  async function renderRoute(route: { options: { component?: ComponentType | undefined } }) {
    const Page = route.options.component;
    if (Page === undefined) throw new Error("the route has no component");
    const router = createRouter({
      routeTree: createRootRoute({ component: () => <Page /> }),
      history: createMemoryHistory(),
    });
    render(<RouterProvider router={router} />);
    return await screen.findByRole("main");
  }

  it("are never offered as a choice: /privacy-choices and /cookies carry no toggle, checkbox or switch", async () => {
    for (const route of [privacyChoicesRoute, cookiesRoute]) {
      const main = await renderRoute(route);
      expect(main.querySelectorAll('input, [role="checkbox"], [role="switch"]')).toHaveLength(0);
      cleanup();
    }
  });

  it("/cookies says they are always on, and /privacy-choices offers only the analytics answer", async () => {
    expect((await renderRoute(cookiesRoute)).textContent).toContain(
      "Necessary cookies are always on.",
    );
    cleanup();
    const main = await renderRoute(privacyChoicesRoute);
    expect(
      within(main)
        .getAllByRole("link", { name: /^(Allow|No, thank you)$/ })
        .map((link) => link.textContent),
    ).toEqual(["Allow", "No, thank you"]);
    expect(main.textContent.toLowerCase()).not.toContain("necessary");
  });
});
