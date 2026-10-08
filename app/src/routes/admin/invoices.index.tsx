import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `invoices.index.lazy.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/invoices/")({
  head: () =>
    pageHead({
      title: "Invoices",
      description: "Every invoice and waiver, and what is still due.",
      path: "/admin/invoices",
      noindex: true,
    }),
});
