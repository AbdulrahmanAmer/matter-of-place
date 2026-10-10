import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "../server/lib/db";
import { cachedResponse } from "../server/public/cache";
import { getCatalog, getPublicState } from "../server/public/state";
import { buildLlmsFull } from "../server/seo/llms";

/** The text of every listed property and story, as plain text; stored as a `doc` under the catalog version (S52). */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: ({ request }) =>
        cachedResponse(
          request,
          "doc",
          async () => {
            const db = getDb();
            const [catalog, state] = await Promise.all([getCatalog(db), getPublicState(db)]);
            return new Response(buildLlmsFull(catalog, state), {
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
          },
          { sMaxAge: 3600, tags: ["seo"] },
        ),
    },
  },
});
