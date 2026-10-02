import { createFileRoute } from "@tanstack/react-router";
import { handleSentryTest } from "../../../server/hooks/sentry-test";

export const Route = createFileRoute("/api/hooks/sentry-test")({
  server: {
    handlers: {
      POST: ({ request }) => handleSentryTest(request, process.env["SENTRY_TEST_TOKEN"]),
    },
  },
});
