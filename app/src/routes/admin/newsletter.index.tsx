import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `newsletter.index.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/newsletter/")({
  head: () =>
    pageHead({
      title: "Newsletter",
      description: "Place Notes issues and subscribers.",
      path: "/admin/newsletter",
      noindex: true,
    }),
});
