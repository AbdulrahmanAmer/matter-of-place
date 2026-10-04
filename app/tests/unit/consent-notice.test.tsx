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
import { CONSENT_VERSION, readConsent } from "../../src/lib/consent";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const css = readFileSync(join(process.cwd(), "src/styles/components/consent.css"), "utf8");

async function renderFooter() {
  const router = createRouter({
    routeTree: createRootRoute({ component: Footer }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Cookie settings" });
}

const notice = () => screen.queryByRole("region", { name: "Cookie notice" });
const control = () => document.querySelector<HTMLButtonElement>("#consent-change");

function store(version: number, analytics: boolean) {
  localStorage.setItem("mop_consent", JSON.stringify({ version, analytics }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(track).mockClear();
});

afterEach(() => {
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

  it("stays closed once decided, and Cookie settings in the footer opens it again", async () => {
    store(CONSENT_VERSION, false);
    await renderFooter();
    expect(notice()).toBeNull();
    act(() => {
      control()?.click();
    });
    expect(await screen.findByRole("region", { name: "Cookie notice" })).toBeTruthy();
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
