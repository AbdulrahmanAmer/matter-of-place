import { createFileRoute, redirect } from "@tanstack/react-router";

/** Prices live on Property Exposure; this address stays valid for old links. */
export const Route = createFileRoute("/_site/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/exposure", statusCode: 301 });
  },
});
