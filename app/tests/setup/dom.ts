import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// G-031: under a full `bun run check` on a busy laptop a route mount and its first query outlast the default 1 s of
// `findBy*` and `waitFor`; the inquiries drawer test went red that way three times on 2026-10-12 and passed alone.
// Five seconds is still under the 60 s test timeout of `bun run test`.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia; components that read a media query get a query that never matches.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
