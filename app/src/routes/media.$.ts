import { createFileRoute } from "@tanstack/react-router";
import { serveMedia } from "../server/public/media";

// ANY, not GET and HEAD: a method with no handler renders the page shell as 200 (G-022).
export const Route = createFileRoute("/media/$")({
  server: {
    handlers: { ANY: ({ request, context }) => serveMedia(request, context.requestId) },
  },
});
