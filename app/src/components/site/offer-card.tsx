import { Link } from "@tanstack/react-router";
import type { Offering } from "../../domain/exposure";
import { track } from "../../lib/analytics";
import { cx } from "../../lib/cx";

/** A Property Exposure product. `compact` shows only name, price and purpose. */
export function OfferCard({
  offering,
  compact = false,
  level = 3,
}: {
  offering: Offering;
  compact?: boolean;
  /** Heading level of the product name: 2 where no section heading sits above the card, 3 under one. */
  level?: 2 | 3;
}) {
  return (
    <article className={cx("fp-card offer-card", offering.recommended && "fp-lead")}>
      {offering.recommended && <p className="offer-flag">Recommended</p>}
      <div className="fp-card-head">
        {level === 2 ? <h2>{offering.name}</h2> : <h3>{offering.name}</h3>}
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
