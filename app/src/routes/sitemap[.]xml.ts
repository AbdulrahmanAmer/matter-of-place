import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "../server/lib/db";
import { cachedResponse } from "../server/public/cache";
import { getCatalog, getPublicState } from "../server/public/state";
import { buildSitemap } from "../server/seo/sitemap";

/** XML sitemap built in process from the catalog snapshot; stored as a `doc` under the catalog version (S52). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) =>
        cachedResponse(
          request,
          "doc",
          async () => {
            const db = getDb();
            const [catalog, state] = await Promise.all([getCatalog(db), getPublicState(db)]);
            return new Response(buildSitemap(catalog, state, new Date()), {
              headers: { "content-type": "application/xml; charset=utf-8" },
            });
          },
          { sMaxAge: 3600, tags: ["seo"] },
        ),
    },
  },
});
