import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `people.index.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/people/")({
  head: () =>
    pageHead({
      title: "People",
      description: "Everyone who has sent a request.",
      path: "/admin/people",
      noindex: true,
    }),
});
