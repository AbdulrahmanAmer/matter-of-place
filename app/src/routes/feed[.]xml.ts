import { createFileRoute } from "@tanstack/react-router";
import { serveFeed } from "../server/public/feeds";

// ANY, not GET and HEAD: a method with no handler renders the page shell as 200 (G-022).
export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: { ANY: ({ request, context }) => serveFeed(request, context.requestId, "rss") },
  },
});
