import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old /markets/<desk>/... addresses move to /<desk>/... */
export const Route = createFileRoute("/markets/$")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/${params._splat ?? ""}`, statusCode: 301 });
  },
});
