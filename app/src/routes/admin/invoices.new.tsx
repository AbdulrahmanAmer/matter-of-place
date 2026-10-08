import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `invoices.new.lazy.tsx`. `submission_id` names the request to invoice;
// without it the page lists the accepted requests to pick from.
export const Route = createFileRoute("/admin/invoices/new")({
  validateSearch: (search: Record<string, unknown>): { submission_id?: string } =>
    typeof search["submission_id"] === "string" && search["submission_id"] !== ""
      ? { submission_id: search["submission_id"] }
      : {},
  head: () =>
    pageHead({
      title: "New invoice",
      description: "Issue an invoice for an accepted request.",
      path: "/admin/invoices/new",
      noindex: true,
    }),
});
