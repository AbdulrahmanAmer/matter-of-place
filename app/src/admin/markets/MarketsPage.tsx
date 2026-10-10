import { useRouter } from "@tanstack/react-router";
import { AdminPending } from "../ui/AdminPending";
import { Tabs } from "../ui/Tabs";
import { useUrlFilters } from "../ui/use-url-filters";
import { MarketEditor } from "./MarketEditor";
import { useMarket, useMarkets } from "./markets-queries";

const marketFilterNames = ["market"] as const;

/** One market's editor, read when its tab opens; the key keeps what was typed while the market is read again. */
function OpenMarket({ slug }: { slug: string }) {
  const market = useMarket(slug);
  if (market.data === undefined) {
    if (market.error === null) return <AdminPending />;
    throw market.error;
  }
  return <MarketEditor key={market.data.slug} market={market.data} />;
}

/** Screen 15: the three markets as tabs, the chosen one in the address, and the editor of that market below. */
export function MarketsPage() {
  const router = useRouter();
  const filters = useUrlFilters(marketFilterNames);
  const list = useMarkets();
  const items = list.data?.items;
  if (items === undefined) {
    if (list.error === null) return <AdminPending />;
    throw list.error;
  }
  const active = items.find((row) => row.slug === filters.values.market) ?? items[0];
  if (active === undefined) return <p>No market is set up yet.</p>;
  return (
    <>
      <h1>Markets</h1>
      <Tabs
        label="Markets"
        tabs={items.map((row) => ({ id: row.slug, label: row.name }))}
        active={active.slug}
        onChange={(slug) => {
          void router.navigate({ href: `/admin/markets?market=${slug}` });
        }}
      >
        <OpenMarket slug={active.slug} />
      </Tabs>
    </>
  );
}
