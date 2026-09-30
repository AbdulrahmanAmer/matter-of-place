import { Link } from "@tanstack/react-router";
import type { Property } from "../../domain/property";
import { formatPrice } from "../../lib/catalog";
import { ContentTag } from "./content-tag";

export function PropertyCard({ property }: { property: Property }) {
  return (
    <Link to="/property/$slug" params={{ slug: property.slug }} className="property-card">
      <div className="property-card-image">
        <img
          src={property.heroImage}
          loading="lazy"
          width={1408}
          height={1008}
          alt={`Illustrative architecture in ${property.city}`}
        />
        <ContentTag />
      </div>
      <div className="property-card-info">
        <div>
          <span className="eyebrow">
            {property.city.toUpperCase()}, {property.state.toUpperCase()}
          </span>
          <h3>{property.title}</h3>
          <span className="property-card-style">{property.style}</span>
        </div>
        <span className="price">{formatPrice(property)}</span>
      </div>
    </Link>
  );
}

export function PropertyGrid({ items }: { items: Property[] }) {
  return (
    <div className="property-grid">
      {items.map((property) => (
        <PropertyCard property={property} key={property.slug} />
      ))}
    </div>
  );
}
