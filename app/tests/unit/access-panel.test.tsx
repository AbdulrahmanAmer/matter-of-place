import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPanel } from "../../src/components/layout/access-panel";
import { MATRICES } from "../../src/components/layout/vision-filters";
import { ACCESS_BOOTSTRAP, ACCESS_KEY, parseAccess } from "../../src/lib/access";
import { openAccess } from "../../src/lib/access-events";

// The accessibility settings (operator, 2026-10-13): a round mark at the bottom right, eight settings and a read-aloud
// bar, every choice kept on this device and drawn on <html> before the first paint; a hidden mark always comes back.

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => "/",
}));

const root = document.documentElement;
const NAMES = [
  "data-text",
  "data-vision",
  "data-contrast",
  "data-spacing",
  "data-font",
  "data-links",
  "data-still",
];
const drawn = () => NAMES.filter((name) => root.hasAttribute(name));
const stored = () => parseAccess(localStorage.getItem(ACCESS_KEY));

beforeEach(() => {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(pointer: fine)" }),
  });
});

afterEach(() => {
  localStorage.clear();
  for (const name of NAMES) root.removeAttribute(name);
});

const openPanel = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Accessibility" }));
  // The panel body loads on first open (access-dialog.tsx), so it is awaited.
  return screen.findByRole("dialog", { name: "Accessibility" });
};

describe("the accessibility settings", () => {
  it("opens from the mark with eight settings, and each tile draws its choice on <html> at once", async () => {
    render(<AccessPanel />);
    await openPanel();
    // The reading guide tile shows once the panel has seen a fine pointer, one render after it opens.
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: /^(Text size|Higher contrast|Text spacing|Readable font|Highlight links|Reading guide|Stop motion|Colour vision):/,
        }),
      ).toHaveLength(8);
    });
    fireEvent.click(screen.getByRole("button", { name: "Text size: Standard" }));
    fireEvent.click(screen.getByRole("button", { name: "Text size: Larger" }));
    fireEvent.click(screen.getByRole("button", { name: "Higher contrast: Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Readable font: Off" }));
    expect(root.getAttribute("data-text")).toBe("2");
    expect(drawn()).toEqual(["data-text", "data-contrast", "data-font"]);
    expect(stored()).toMatchObject({ text: 2, contrast: true, font: true });
    expect(
      screen.getByRole("button", { name: "Higher contrast: On" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("cycles colour vision through the three corrective filters and back to off", async () => {
    render(<AccessPanel />);
    await openPanel();
    const seen: (string | null)[] = [];
    for (const name of ["Off", "Green-weak", "Red-weak", "Blue-yellow"]) {
      fireEvent.click(screen.getByRole("button", { name: `Colour vision: ${name}` }));
      seen.push(root.getAttribute("data-vision"));
    }
    expect(seen).toEqual(["deutan", "protan", "tritan", null]);
  });

  it("closes on Escape and gives the focus back to the mark", async () => {
    render(<AccessPanel />);
    await openPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Accessibility");
  });

  it("hides the mark behind a tab, and the tab brings it back with the focus on it", async () => {
    render(<AccessPanel />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Hide button" }));
    const tab = await screen.findByRole("button", { name: "Show the accessibility button" });
    expect(screen.queryByRole("button", { name: "Accessibility" })).toBeNull();
    expect(stored().hidden).toBe(true);
    fireEvent.click(tab);
    const mark = await screen.findByRole("button", { name: "Accessibility" });
    await waitFor(() => {
      expect(document.activeElement).toBe(mark);
    });
    expect(stored().hidden).toBe(false);
  });

  it("brings a hidden mark back and opens the panel from the footer link and from Alt + A", async () => {
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ hidden: true }));
    render(<AccessPanel />);
    await screen.findByRole("button", { name: "Show the accessibility button" });
    act(() => {
      openAccess();
    });
    expect(await screen.findByRole("dialog", { name: "Accessibility" })).toBeTruthy();
    expect(stored().hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hide button" }));
    await screen.findByRole("button", { name: "Show the accessibility button" });
    fireEvent.keyDown(window, { key: "a", code: "KeyA", altKey: true });
    expect(await screen.findByRole("dialog", { name: "Accessibility" })).toBeTruthy();
  });

  it("Reset all returns every setting to the design", async () => {
    render(<AccessPanel />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Text spacing: Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour vision: Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(drawn()).toEqual([]);
  });
});

describe("the head script and the colour filters", () => {
  it("draws a stored choice on <html> before the page renders, and ignores what it cannot read", () => {
    localStorage.setItem(
      ACCESS_KEY,
      JSON.stringify({ text: 1, vision: "tritan", links: true, still: true, spacing: "yes" }),
    );
    // The exact text the page sends and the policy hashes, run as the browser runs it.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- a constant of our own, the script under test
    new Function(ACCESS_BOOTSTRAP)();
    expect([root.getAttribute("data-text"), root.getAttribute("data-vision"), ...drawn()]).toEqual([
      "1",
      "tritan",
      "data-text",
      "data-vision",
      "data-links",
      "data-still",
    ]);
    expect(parseAccess("{not json")).toEqual(parseAccess(null));
    expect(ACCESS_BOOTSTRAP.includes("\\")).toBe(false);
  });

  it("keeps every grey grey: each row of each corrective matrix sums to 1", () => {
    const sums = Object.values(MATRICES).flatMap((values) => {
      const numbers = values.split(" ").map(Number);
      return [0, 1, 2].map((row) =>
        Number(
          numbers
            .slice(row * 5, row * 5 + 3)
            .reduce((a, b) => a + b, 0)
            .toFixed(3),
        ),
      );
    });
    expect(sums).toEqual(Array.from({ length: 9 }, () => 1));
  });
});
