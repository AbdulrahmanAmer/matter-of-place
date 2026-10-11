import { createFileRoute } from "@tanstack/react-router";
import { docResponse } from "../server/seo/doc-route";
import { buildSitemap } from "../server/seo/sitemap";

/** XML sitemap built in process from the catalog snapshot; stored as a `doc` under the catalog version (S52). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) =>
        docResponse(request, "application/xml; charset=utf-8", (catalog, state) =>
          buildSitemap(catalog, state, new Date()),
        ),
    },
  },
});
