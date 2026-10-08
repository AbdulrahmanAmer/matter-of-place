import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the editor lives in `properties.$id.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/properties/$id")({
  head: ({ params }) =>
    pageHead({
      title: "Property",
      description: "One property's dossier.",
      path: `/admin/properties/${params.id}`,
      noindex: true,
    }),
});
