import { createFileRoute } from "@tanstack/react-router";
import { serveMedia } from "../server/public/media";

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ request, context }) => serveMedia(request, context.requestId),
      HEAD: ({ request, context }) => serveMedia(request, context.requestId),
    },
  },
});
