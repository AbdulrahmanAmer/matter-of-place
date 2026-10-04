import { createFileRoute } from "@tanstack/react-router";
import { handlePublic } from "../../../server/public/pipeline";

export const Route = createFileRoute("/api/public/csp-report")({
  server: {
    handlers: { ANY: ({ request, context }) => handlePublic(request, context.requestId) },
  },
});
