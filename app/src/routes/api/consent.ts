import { createFileRoute } from "@tanstack/react-router";
import { setConsent } from "../../server/public/consent";

export const Route = createFileRoute("/api/consent")({
  server: {
    handlers: { GET: ({ request, context }) => setConsent(request, context.requestId) },
  },
});
