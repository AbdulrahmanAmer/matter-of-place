import { createFileRoute } from "@tanstack/react-router";
import { SeoPage } from "../components/site/seo-page";
import { requireSeoPage } from "../content/seo";
import { seoPageHead } from "../lib/seo-page";

// A collection guide is one content file in `src/content/seo`; this file only gives it its address.
const page = requireSeoPage("/historic-homes-for-sale-hudson-valley");

export const Route = createFileRoute("/_site/historic-homes-for-sale-hudson-valley")({
  head: ({ matches }) => seoPageHead(page, matches),
  component: () => <SeoPage page={page} />,
});
