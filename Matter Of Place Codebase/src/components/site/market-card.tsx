import { Link } from "@tanstack/react-router";
import type { Market } from "../../domain/market";

export function MarketCard({ market }: { market: Market }) {
  return (
    <Link to="/$market" params={{ market: market.slug }} className="market-card">
      <img
        src={market.image}
        loading="lazy"
        width={1408}
        height={1008}
        alt={`Illustrative ${market.name} architecture`}
      />
      <div>
        <span className="eyebrow">EDITORIAL DESK</span>
        <h3>{market.name}</h3>
        <p>{market.regions.map((region) => region.name).join(" · ")}</p>
      </div>
    </Link>
  );
}

export function MarketGrid({ markets }: { markets: Market[] }) {
  return (
    <div className="market-grid">
      {markets.map((market) => (
        <MarketCard key={market.slug} market={market} />
      ))}
    </div>
  );
}
