// The cookie notice (GP-02): in the footer, in flow, never a dialog, and a choice that can be changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "../../src/components/layout/footer";
import { track } from "../../src/lib/analytics";
import { CONSENT_VERSION, consentGranted, readConsent, writeConsent } from "../../src/lib/consent";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const css = readFileSync(join(process.cwd(), "src/styles/components/consent.css"), "utf8");

async function renderFooter() {
  const router = createRouter({
    routeTree: createRootRoute({ component: Footer }),
    history: createMemoryHistory(),
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

  it("is never fixed or sticky", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    await renderFooter();
    const region = await screen.findByRole("region", { name: "Cookie notice" });
    expect(["fixed", "sticky"]).not.toContain(getComputedStyle(region).position);
  });
});
