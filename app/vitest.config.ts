import { defineConfig } from "vitest/config";

// An inline project does not inherit the root `test` block, so each project sets requireAssertions itself (CS-12).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
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
