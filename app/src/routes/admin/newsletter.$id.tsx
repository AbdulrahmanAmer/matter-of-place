import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `newsletter.$id.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/newsletter/$id")({
  head: ({ params }) =>
    pageHead({
      title: "Place Notes issue",
      description: "One issue of Place Notes.",
      path: `/admin/newsletter/${params.id}`,
      noindex: true,
    }),
});
