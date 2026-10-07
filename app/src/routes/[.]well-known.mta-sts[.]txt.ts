import { createFileRoute } from "@tanstack/react-router";
import { mtaStsTxt } from "../server/public/identity";

export const Route = createFileRoute("/.well-known/mta-sts.txt")({
  server: {
    handlers: { ANY: ({ request, context }) => mtaStsTxt(request, context.requestId) },
  },
});
