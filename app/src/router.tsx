import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // The server render sends the query cache its loaders filled; the browser starts from it, so a
    // page load makes no second catalog request (architecture 13, layer 2).
    // @ts-expect-error -- a dehydrated query holds `unknown` keys and data, which the router's serializability type refuses; the document serializer handles them
    dehydrate: () => ({ queryClientState: dehydrate(queryClient) }),
    hydrate: (data) => {
      hydrate(queryClient, data.queryClientState);
    },
  });

  return router;
};
