import { createFileRoute } from "@tanstack/react-router";
import { docResponse } from "../server/seo/doc-route";
import { buildLlmsTxt } from "../server/seo/llms";

/** The index of what is published, as plain text; stored as a `doc` under the catalog version (S52). */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: ({ request }) => docResponse(request, "text/plain; charset=utf-8", buildLlmsTxt),
    },
  },
});
