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
    ],
  },
});
