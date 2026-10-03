import { defineConfig } from "vitest/config";

// An inline project does not inherit the root `test` block, so each project sets requireAssertions itself (CS-12).
// Both setup files run in every unit and component test: hermetic.ts removes credentials and the network (R50).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/hermetic.ts"],
          expect: { requireAssertions: true },
        },
      },
      {
        test: {
          name: "component",
          include: ["tests/unit/**/*.test.tsx", "src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/setup/dom.ts", "tests/setup/hermetic.ts"],
          expect: { requireAssertions: true },
        },
      },
      {
        // F22: B3's and B3b's `tests/api` files run here too. One file at a time while the tests share mop-dev (F21).
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts", "tests/api/**/*.api.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          testTimeout: 30000,
          fileParallelism: false,
          expect: { requireAssertions: true },
        },
      },
    ],
  },
});
