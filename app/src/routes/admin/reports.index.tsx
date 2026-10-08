import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `reports.index.lazy.tsx`, which the public entry never loads. The search
// keeps the page and the campaign the table is narrowed to; a `campaign` that is not a uuid is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin/reports/")({
  validateSearch: (search: Record<string, unknown>) => {
    const campaign = text(search["campaign"]);
    return {
      campaign: campaign !== undefined && UUID.test(campaign) ? campaign : undefined,
      cursor: text(search["cursor"]),
    };
  },
  head: () =>
    pageHead({
      title: "Reports",
      description: "The weekly figures of each campaign: reach, views, visits and the channel mix.",
      path: "/admin/reports",
      noindex: true,
    }),
});
