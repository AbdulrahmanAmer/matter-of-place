import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/inquiries/InquiriesPage.tsx`, which the public entry never
// loads. The search keeps the state filter, the cursor and `id`, the inquiry the `inquiry.received` mail links to; an
// `id` that is not a uuid is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin/inquiries/")({
  validateSearch: (search: Record<string, unknown>) => {
    const id = text(search["id"]);
    return {
      state: text(search["state"]),
      cursor: text(search["cursor"]),
      id: id !== undefined && UUID.test(id) ? id : undefined,
    };
  },
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Inquiries",
      description: "Showing and contact requests from the site.",
      path: "/admin/inquiries",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/inquiries/InquiriesPage"),
    "InquiriesPage",
  ),
});
