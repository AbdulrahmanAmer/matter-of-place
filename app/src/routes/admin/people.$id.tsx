import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `people.$id.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/people/$id")({
  head: ({ params }) =>
    pageHead({
      title: "Person",
      description: "One person and everything they have sent.",
      path: `/admin/people/${params.id}`,
      noindex: true,
    }),
});
