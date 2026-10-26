import { createFileRoute } from "@tanstack/react-router";
import { SeoPage } from "../components/site/seo-page";
import { seoPageHead } from "../lib/seo-page";

// A collection guide is one content file in `src/content/seo`; this file only gives it its address. The copy is
// loaded by the route, never imported at the top: a static import would put the page in the chunk every route loads.
export const Route = createFileRoute("/_site/mid-century-modern-homes")({
  loader: async () =>
    (await import("../content/seo/mid-century-modern-homes")).midCenturyModernHomes,
  head: ({ loaderData, matches }) => seoPageHead(loaderData, matches),
  component: MidCenturyModernHomesPage,
});

function MidCenturyModernHomesPage() {
  return <SeoPage page={Route.useLoaderData()} />;
}
