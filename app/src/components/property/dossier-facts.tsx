import type { Property } from "../../domain/property";
import { formatNumber } from "../../lib/format";

export function DossierFacts({ property }: { property: Property }) {
  const facts: [value: string | number, label: string][] = [
    [property.beds, "Bedrooms"],
    [property.baths, "Bathrooms"],
    [formatNumber(property.interiorSqFt), "Sq ft"],
    [property.lotAcres, "Acres"],
    [property.yearBuilt, "Built"],
  ];
  return (
    <div className="dossier-facts">
      {facts.map(([value, label]) => (
        <div key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
