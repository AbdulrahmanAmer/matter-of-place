import { createFileRoute } from "@tanstack/react-router";
import { handlePublic } from "../../../server/public/pipeline";

export const Route = createFileRoute("/api/public/submissions/$id/uploads")({
  server: {
    handlers: { ANY: ({ request, context }) => handlePublic(request, context.requestId) },
  },
});
