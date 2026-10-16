import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `proposed-posts.index.lazy.tsx`, which the public entry never loads. The
// search keeps the status filter; a status the screen does not know is dropped.
const statuses = new Set(["proposed", "rejected", "approved", "scheduled", "posted"]);

export const Route = createFileRoute("/admin/proposed-posts/")({
  validateSearch: (search: Record<string, unknown>) => {
    const status = search["status"];
    return { status: typeof status === "string" && statuses.has(status) ? status : undefined };
  },
  head: () =>
    pageHead({
      title: "Proposed posts",
      description: "What the team proposes to post, as it will look on each channel.",
      path: "/admin/proposed-posts",
      noindex: true,
    }),
});
