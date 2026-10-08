import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `properties.index.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/properties/")({
  head: () =>
    pageHead({
      title: "Properties",
      description: "Every property, its state and its place on the site.",
      path: "/admin/properties",
      noindex: true,
    }),
});
