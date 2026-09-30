import { createFileRoute } from "@tanstack/react-router";
import { MarketGrid } from "../components/site/market-card";
import { PageIntro } from "../components/site/page-intro";
import { marketsQuery } from "../lib/queries";
import { pageHead } from "../lib/seo";

const description = "California, New York and Florida. Three markets, one editorial point of view.";

export const Route = createFileRoute("/markets/")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(marketsQuery()),
  head: () => pageHead({ title: "Markets", description, path: "/markets" }),
  component: MarketsPage,
});

function MarketsPage() {
  const markets = Route.useLoaderData();
  return (
    <main>
      <PageIntro
        eyebrow="THREE EDITORIAL DESKS"
        title="Markets"
        text="Three markets. One editorial point of view."
      />
      <section className="section-wrap collection">
        <MarketGrid markets={markets} />
      </section>
    </main>
  );
}
