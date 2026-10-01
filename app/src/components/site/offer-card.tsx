import { Link } from "@tanstack/react-router";
import type { Offering } from "../../domain/exposure";
import { track } from "../../lib/analytics";
import { cx } from "../../lib/cx";

/** A Property Exposure product. `compact` shows only name, price and purpose. */
export function OfferCard({
  offering,
  compact = false,
}: {
  offering: Offering;
  compact?: boolean;
}) {
  return (
    <article className={cx("fp-card offer-card", offering.recommended && "fp-lead")}>
      {offering.recommended && <p className="offer-flag">Recommended</p>}
      <div className="fp-card-head">
        <h3>{offering.name}</h3>
        <span>{offering.price}</span>
      </div>
      <p className="fp-line">{offering.line}</p>
      {offering.note && <p className="fp-offer-for">{offering.note}</p>}
      {!compact && (
        <>
          <ul>
            {offering.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Link
            to="/submit"
            className="text-link"
            onClick={() => track("package_interest", { package: offering.id })}
          >
            {offering.cta}
          </Link>
        </>
      )}
    </article>
  );
}
