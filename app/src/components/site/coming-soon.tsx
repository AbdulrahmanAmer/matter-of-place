import type { Market } from "../../domain/market";
import { useTrackView } from "../../hooks/use-track-view";
import { comingSoonText, interestSource, type ComingSoonScope } from "../../lib/coming-soon";
import { fill, t } from "../../lib/strings";
import { InterestForm } from "../forms/interest-form";

/**
 * The empty state of a collection: what is coming, and the signup that says where the visitor is looking. It is
 * the same markup for every visitor, so cached pages stay identical.
 */
export function ComingSoon({
  scope,
  market,
  region,
}: {
  scope: ComingSoonScope;
  market?: Pick<Market, "name" | "slug" | "interestCopy">;
  region?: Pick<Market["regions"][number], "name" | "slug">;
}) {
  useTrackView("coming_soon_view", interestSource(scope, market, region), { scope });
  const names = { market: market?.name, region: region?.name };
  return (
    <section className="section-wrap coming-soon">
      <p className="eyebrow">{t.comingSoon.eyebrow}</p>
      <div className="coming-soon-body">
        <h2>{fill(t.comingSoon[scope].title, names)}</h2>
        <p>{comingSoonText(scope, market, region)}</p>
        <InterestForm scope={scope} market={market} region={region} />
      </div>
    </section>
  );
}
