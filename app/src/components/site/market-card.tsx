import { Link } from "@tanstack/react-router";
import type { Market } from "../../domain/market";
import { t } from "../../lib/strings";
import { Picture } from "./picture";

export function MarketCard({ market }: { market: Market }) {
  const open = !market.comingSoon;
  return (
    <Link to="/$market" params={{ market: market.slug }} className="market-card">
      {open && market.image !== undefined && (
        <Picture
          src={market.image}
          sizes="(max-width: 700px) 100vw, 33vw"
          width={1408}
          height={1008}
          alt={`${market.name} architecture`}
        />
      )}
      <div>
        <span className="eyebrow">{open ? "EDITORIAL DESK" : t.comingSoon.badge}</span>
        <h3>{market.name}</h3>
        <p>
          {open ? market.regions.map((region) => region.name).join(" · ") : t.comingSoon.cardLine}
        </p>
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
