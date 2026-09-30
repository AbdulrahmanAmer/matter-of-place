import type { Property } from "../../domain/property";
import { formatPrice } from "../../lib/catalog";
import { formatNumber } from "../../lib/format";
import { Wordmark } from "../brand/wordmark";
import { TextButton } from "../site/text-link";

/** Square social cover for the property, with the share action beneath. */
export function ShareCover({
  property,
  copied,
  onShare,
}: {
  property: Property;
  copied: boolean;
  onShare: () => void;
}) {
  return (
    <section className="section-wrap share-cover-section">
      <p className="eyebrow">PRESERVE & SHARE</p>
      <div className="share-cover">
        <div className="share-cover-header">
          <Wordmark />
        </div>
        <div className="share-cover-image">
          <img
            src={property.gallery[0]?.src ?? property.heroImage}
            loading="lazy"
            width={800}
            height={800}
            alt=""
          />
        </div>
        <div className="share-cover-footer">
          <div className="share-cover-location">
            {property.city.toUpperCase()}, {property.state.toUpperCase()}
          </div>
          <div className="share-cover-price">{formatPrice(property)}</div>
          <div className="share-cover-specs">
            {property.beds} BD · {property.baths} BA · {formatNumber(property.interiorSqFt)} SQ FT
          </div>
        </div>
      </div>
      <TextButton onClick={onShare}>{copied ? "Link copied" : "Share property cover"}</TextButton>
    </section>
  );
}
