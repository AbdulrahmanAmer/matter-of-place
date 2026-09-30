import { properties } from "../../data/properties";
import { formatPrice, relatedProperties } from "../../lib/catalog";
import { formatNumber } from "../../lib/format";
import { ServiceError, type ConciergeAnswer, type ConciergeService } from "../types";

/**
 * Ask Matter of Place, answered from the dossier itself. The `http` adapter
 * routes the same questions to the concierge service; the four questions and
 * the answer shape are the contract.
 */
export const localConcierge: ConciergeService = {
  async answer({ propertySlug, question }): Promise<ConciergeAnswer> {
    const property = properties.find((item) => item.slug === propertySlug);
    if (!property) throw new ServiceError("not-found", "Property not found");

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
        const nearby = relatedProperties(properties, property, 1)[0];
        return nearby
          ? {
              text: `Nearby, you may also like this ${nearby.type.toLowerCase()} in ${nearby.city}, ${formatPrice(nearby)}.`,
              link: { slug: nearby.slug, title: nearby.title },
            }
          : { text: "There are no other properties in this area yet." };
      }
      case "Can you send the full details?":
        return {
          text: `In brief: ${property.beds} bedrooms, ${property.baths} bathrooms, ${formatNumber(property.interiorSqFt)} sq ft on ${property.lotAcres} acres, built ${property.yearBuilt}. ${formatPrice(property)}. ${property.features.slice(0, 2).join("; ")}. Ask about this property to receive the full dossier by email.`,
        };
    }
  },
};
