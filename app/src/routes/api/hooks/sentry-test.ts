import { createFileRoute } from "@tanstack/react-router";
import { handleSentryTest } from "../../../server/hooks/sentry-test";
import { env } from "../../../server/lib/env";

export const Route = createFileRoute("/api/hooks/sentry-test")({
  server: {
    handlers: {
      POST: ({ request, context }) =>
        handleSentryTest(request, context.requestId, env.SENTRY_TEST_TOKEN),
    },
  },
});
