import { createFileRoute } from "@tanstack/react-router";
import { handleSentryTest } from "../../../server/hooks/sentry-test";

export const Route = createFileRoute("/api/hooks/sentry-test")({
  server: {
    handlers: {
      // STUB(B8 step 2a): SENTRY_TEST_TOKEN read through src/server/lib/env.ts (R14), as start.ts reads MOP_ENV (B3 closed without it)
      POST: ({ request, context }) =>
        handleSentryTest(request, context.requestId, process.env["SENTRY_TEST_TOKEN"]),
    },
  },
});
