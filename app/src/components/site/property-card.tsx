import { Link } from "@tanstack/react-router";
import type { PropertyCard as PropertyCardData } from "../../domain/property";
import { formatPrice } from "../../lib/catalog";
import { ContentTag } from "./content-tag";
import { Picture } from "./picture";

export function PropertyCard({ property }: { property: PropertyCardData }) {
  const illustrative = property.status === "Illustrative";
  return (
    <Link to="/property/$slug" params={{ slug: property.slug }} className="property-card">
      <div className="property-card-image">
        <Picture
          src={property.heroImage}
          variants={property.heroVariants}
          sizes="(max-width: 700px) 100vw, 50vw"
          width={1408}
          height={1008}
          alt={`${illustrative ? "Illustrative architecture" : "Architecture"} in ${property.city}`}
        />
        {illustrative && <ContentTag />}
      </div>
      <div className="property-card-info">
        <div className="property-card-meta">
          <span className="eyebrow">
            {property.city.toUpperCase()}, {property.state.toUpperCase()}
          </span>
          <span className="price">{formatPrice(property)}</span>
        </div>
        <h3>{property.title}</h3>
        <span className="property-card-style">{property.style}</span>
      </div>
    </Link>
  );
}

export function PropertyGrid({ items }: { items: PropertyCardData[] }) {
  return (
    <div className="property-grid">
      {items.map((property) => (
        <PropertyCard property={property} key={property.slug} />
      ))}
    </div>
  );
}
