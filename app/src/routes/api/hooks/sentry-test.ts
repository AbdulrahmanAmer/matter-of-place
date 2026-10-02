import { createFileRoute } from "@tanstack/react-router";
import { handleSentryTest } from "../../../server/hooks/sentry-test";

export const Route = createFileRoute("/api/hooks/sentry-test")({
  server: {
    handlers: {
      // STUB(B3): SENTRY_TEST_TOKEN read through src/server/lib/env.ts (R14), as start.ts reads MOP_ENV
      POST: ({ request }) => handleSentryTest(request, process.env["SENTRY_TEST_TOKEN"]),
    },
  },
});
