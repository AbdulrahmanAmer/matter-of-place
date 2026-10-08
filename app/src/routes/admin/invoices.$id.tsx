import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `invoices.$id.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/invoices/$id")({
  head: ({ params }) =>
    pageHead({
      title: "Invoice",
      description: "One invoice, its payment and what can be done next.",
      path: `/admin/invoices/${params.id}`,
      noindex: true,
    }),
});
