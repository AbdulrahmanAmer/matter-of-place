import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { Market } from "../../domain/market";
import { t } from "../../lib/strings";
import { Picture } from "./picture";

/**
 * A market with a published property is a photograph card. One still opening is an editorial entry instead
 * (operator, 2026-10-11: the empty boxes said nothing): its name, its own introduction, its regions and a way to
 * hear when it opens, which the market page's signup answers.
 */
export function MarketCard({ market }: { market: Market }) {
  const open = !market.comingSoon;
  const regions = market.regions.map((region) => region.name).join(" · ");
  // The first sentence of the introduction stands on its own; the market page carries the rest.
  const opening = /^.*?[.!?](?=\s|$)/.exec(market.intro)?.[0] ?? market.intro;
  if (!open) {
    return (
      <Link
        to="/$market"
        params={{ market: market.slug }}
        className="market-card market-card-opening"
      >
        <div>
          <span className="eyebrow market-card-state">
            <span className="market-hero-dot" aria-hidden="true" />
            {t.comingSoon.badge}
          </span>
          <h3>{market.name}</h3>
          <p className="market-card-intro">{opening}</p>
          {regions !== "" && <p className="market-card-regions">{regions}</p>}
          <span className="market-card-cta">
            {t.comingSoon.cardLine} <ArrowRight size={16} aria-hidden="true" />
          </span>
        </div>
      </Link>
    );
  }
  return (
    <Link to="/$market" params={{ market: market.slug }} className="market-card">
      {market.image !== undefined && (
        <Picture
          src={market.image}
          sizes="(max-width: 700px) 100vw, 33vw"
          width={1408}
          height={1008}
          alt={`${market.name} architecture`}
        />
      )}
      <div>
        <span className="eyebrow">EDITORIAL DESK</span>
        <h3>{market.name}</h3>
        <p>{regions}</p>
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
