import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyMarketTarget } from "../lib/legacy-markets";

/** Old /markets/<desk>/... addresses move to /<desk>/... */
export const Route = createFileRoute("/_site/markets/$")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: legacyMarketTarget(params._splat), statusCode: 301 });
  },
});
