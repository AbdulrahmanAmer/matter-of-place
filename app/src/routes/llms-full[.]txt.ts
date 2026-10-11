import { createFileRoute } from "@tanstack/react-router";
import { docResponse } from "../server/seo/doc-route";
import { buildLlmsFull } from "../server/seo/llms";

/** The text of every listed property and story, as plain text; stored as a `doc` under the catalog version (S52). */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: ({ request }) => docResponse(request, "text/plain; charset=utf-8", buildLlmsFull),
    },
  },
});
