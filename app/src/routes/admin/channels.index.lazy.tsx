import { createLazyFileRoute } from "@tanstack/react-router";
import { ChannelsPage } from "../../admin/channels/ChannelsPage";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";

// The page of the `channels.index.tsx` shell (ruling H66). The route has no loader: the cards, the withdraw list and
// the table each read their own data.
export const Route = createLazyFileRoute("/admin/channels/")({
  errorComponent: AdminRouteError,
  component: ChannelsPage,
});
