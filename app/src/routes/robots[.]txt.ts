import { createFileRoute } from "@tanstack/react-router";
import { env } from "../server/lib/env";
import { cachedResponse } from "../server/public/cache";
import { buildRobots, isIndexableHost } from "../server/seo/robots";

/** `robots.txt` for the host asked: stored as a `doc` only for the indexable host, never for another. */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host = request.headers.get("host") ?? new URL(request.url).host;
        if (!isIndexableHost(host, env.MOP_ENV)) {
          const closed = buildRobots(host, env.MOP_ENV);
          closed.headers.set("x-mop-cache", "bypass");
          return closed;
        }
        return cachedResponse(
          request,
          "doc",
          () => Promise.resolve(buildRobots(host, env.MOP_ENV)),
          { sMaxAge: 3600, tags: ["seo"] },
        );
      },
    },
  },
});
