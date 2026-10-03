import { createFileRoute } from "@tanstack/react-router";
import { handlePublic } from "../../../server/public/pipeline";

export const Route = createFileRoute("/api/public/properties/$slug")({
  server: {
    handlers: { GET: ({ request, context }) => handlePublic(request, context.requestId) },
  },
});
