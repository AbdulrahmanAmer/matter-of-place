import { createLazyFileRoute } from "@tanstack/react-router";
import { ProposedPostsPage } from "../../admin/proposed-posts/ProposedPostsPage";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";

// The page of the `proposed-posts.index.tsx` shell (ruling H66). The route has no loader: the page reads its own data.
export const Route = createLazyFileRoute("/admin/proposed-posts/")({
  errorComponent: AdminRouteError,
  component: ProposedPostsPage,
});
