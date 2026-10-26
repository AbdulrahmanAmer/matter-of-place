import { createFileRoute } from "@tanstack/react-router";
import { MarketGrid } from "../components/site/market-card";
import { PageIntro } from "../components/site/page-intro";
import { marketsQuery } from "../lib/queries";
import { breadcrumbLd, collectionLd, type Crumb } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

const trail: Crumb[] = [{ name: "Markets", path: "/markets" }];

export const Route = createFileRoute("/_site/markets/")({
  loader: ({ context: { queryClient } }) =>
    queryClient.query({ ...marketsQuery(), staleTime: "static" }),
  head: ({ loaderData, matches }) =>
    pageHead({
      title: "Markets",
      description: pageDescription("markets.index"),
      path: "/markets",
      image: ogImageFor({ key: "markets", ogStatic: ogStaticOf(matches) }),
      jsonLd: [
        collectionLd(
          "markets",
          "Markets",
          "/markets",
          (loaderData ?? []).map((market) => ({ name: market.name, path: `/${market.slug}` })),
        ),
        breadcrumbLd(trail),
      ],
    }),
  component: MarketsPage,
});

function MarketsPage() {
  const markets = Route.useLoaderData();
  return (
    <main>
      <PageIntro
        trail={trail}
        eyebrow="THREE EDITORIAL DESKS"
        title="Markets"
        text="Three markets. One editorial point of view."
      />
      <section className="section-wrap collection">
        <MarketGrid markets={markets} level={2} />
      </section>
    </main>
  );
}
