import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `assets.index.lazy.tsx`, which the public entry never loads. The search
// carries the filters (`status`, `kind`), the open property (`property_id`) and `page`; the page reads them.
export const Route = createFileRoute("/admin/assets/")({
  head: () =>
    pageHead({
      title: "Assets",
      description: "Creative waiting for a decision.",
      path: "/admin/assets",
      noindex: true,
    }),
});
