import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The one Playwright config (B4 step 5). E2E_TARGET says where the site runs: `dev` (bun run dev, laptop only),
// `built` (wrangler dev on the existing .output, built beforehand with the variables of its mode) or `url` (a deployed
// preview, no server). E2E_MODE says which adapter the build uses: `local` (bundled data) or `live` (the public API).
// E2E_PORT moves the server off its default port so lanes can run side by side (ruling H45).
const target = process.env["E2E_TARGET"] ?? "dev";
const mode = process.env["E2E_MODE"] ?? "local";
if (target !== "dev" && target !== "built" && target !== "url") {
  throw new Error(`E2E_TARGET must be dev, built or url, not ${target}`);
}
if (mode !== "local" && mode !== "live")
  throw new Error(`E2E_MODE must be local or live, not ${mode}`);

const port = Number(process.env["E2E_PORT"] ?? (target === "built" ? 8788 : 8080));
const baseURL =
  target === "url" ? process.env["E2E_BASE_URL"] : `http://127.0.0.1:${port.toString()}`;
if (baseURL === undefined || baseURL === "") throw new Error("E2E_TARGET=url needs E2E_BASE_URL");
// Read by the fixtures, which run in worker processes that inherit these.
process.env["E2E_MODE"] = mode;
process.env["E2E_BASE_URL"] = baseURL;

const serverCommand =
  target === "built"
    ? `bunx wrangler dev --config .output/server/wrangler.json --env-file "${resolve(".dev.vars")}" --port ${port.toString()} --var MOP_ENV:local`
    : `bun run dev -- --port ${port.toString()}`;

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
const phone = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};
// The overflow subset runs only against a deployed preview (invariant 5).
const skipOverflow = target === "url" ? {} : { grepInvert: /@overflow/ };

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  retries: process.env["CI"] ? 1 : 0,
  failOnFlakyTests: Boolean(process.env["CI"]),
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: true,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testMatch: [
        "**/sweep.spec.ts",
        "**/forms.spec.ts",
        "**/redirects.spec.ts",
        "**/consent.spec.ts",
        "**/essentials.spec.ts",
        "**/a11y-settle.spec.ts",
      ],
      ...skipOverflow,
      use: desktop,
    },
    {
      name: "phone",
      testMatch: [
        "**/sweep.spec.ts",
        "**/forms.spec.ts",
        "**/redirects.spec.ts",
        "**/consent.spec.ts",
        "**/essentials.spec.ts",
      ],
      ...skipOverflow,
      use: phone,
    },
    {
      name: "live-desktop",
      testMatch: ["**/live-forms.spec.ts", "**/hydration.spec.ts", "**/client-error.spec.ts"],
      use: desktop,
    },
    { name: "inquiry-forward", testMatch: "**/inquiry-forward.spec.ts", use: desktop },
    { name: "edge", testMatch: "**/edge-cache.spec.ts", use: desktop },
    { name: "seo", testMatch: "**/seo.spec.ts", use: desktop },
    { name: "coming-soon-desktop", testMatch: "**/coming-soon.spec.ts", use: desktop },
    { name: "coming-soon-phone", testMatch: "**/coming-soon.spec.ts", use: phone },
    // B7's admin specs, desktop only; the later slices' files are listed here so they never edit this config.
    {
      name: "admin",
      testMatch: [
        "**/admin-signin.spec.ts",
        "**/admin-editorial.spec.ts",
        "**/admin-full-path.spec.ts",
        "**/admin-invoice.spec.ts",
        "**/automation-exit.spec.ts",
        "**/admin-assets.spec.ts",
        "**/admin-channels.spec.ts",
        "**/admin-newsletter.spec.ts",
        "**/admin-jobs.spec.ts",
      ],
      // Admin pages render in the browser only (`ssr: false`), and `vite dev` compiles them on first request.
      timeout: 120_000,
      expect: { timeout: 30_000 },
      use: desktop,
    },
  ],
  ...(target === "url"
    ? {}
    : {
        webServer: {
          command: serverCommand,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
