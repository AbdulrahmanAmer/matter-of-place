import type { ConciergeAnswer, ConciergeQuestion } from "../domain/contracts";
import type { Property, PropertyCard } from "../domain/property";
import { formatPrice, relatedProperties } from "./catalog";
import { formatNumber } from "./format";

/**
 * Ask Matter of Place, answered from the dossier itself: the four questions and the answer shape are the contract.
 * Pure, so the local adapter and the Worker answer the same way. `pool` is the list "nearby" draws from.
 */
export function answerFor(
  property: Property,
  question: ConciergeQuestion["question"],
  pool: PropertyCard[],
): ConciergeAnswer {
  switch (question) {
    case "Is the property still available?":
      return {
        text: `This property is shown as ${property.status.toLowerCase()}. Availability is confirmed by the listing representative.`,
      };
    case "Can I request a private showing?":
      return {
        text: "Yes. Showings are arranged through the listing representative. You can write your request from here.",
        action: "showing",
      };
    case "Are there similar properties nearby?": {
      const nearby = relatedProperties(pool, property, 1)[0];
      return nearby
        ? {
            text: `Nearby, you may also like this ${nearby.type.toLowerCase()} in ${nearby.city}, ${formatPrice(nearby)}.`,
            link: { slug: nearby.slug, title: nearby.title },
          }
        : { text: "There are no other properties in this area yet." };
    }
    case "Can you send the full details?":
      return {
        text: `In brief: ${String(property.beds)} bedrooms, ${String(property.baths)} bathrooms, ${formatNumber(property.interiorSqFt)} sq ft on ${String(property.lotAcres)} acres, built ${String(property.yearBuilt)}. ${formatPrice(property)}. ${property.features.slice(0, 2).join("; ")}. Ask about this property to receive the full dossier by email.`,
      };
  }
}
