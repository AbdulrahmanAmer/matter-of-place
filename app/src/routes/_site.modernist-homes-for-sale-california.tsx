import { createFileRoute } from "@tanstack/react-router";
import { SeoPage } from "../components/site/seo-page";
import { requireSeoPage } from "../content/seo";
import { seoPageHead } from "../lib/seo-page";

// A collection guide is one content file in `src/content/seo`; this file only gives it its address.
const page = requireSeoPage("/modernist-homes-for-sale-california");

export const Route = createFileRoute("/_site/modernist-homes-for-sale-california")({
  head: ({ matches }) => seoPageHead(page, matches),
  component: () => <SeoPage page={page} />,
});
