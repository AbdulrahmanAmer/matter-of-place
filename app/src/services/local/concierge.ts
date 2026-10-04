import { properties } from "../../data/properties";
import { answerFor } from "../../lib/concierge-rules";
import { ServiceError, type ConciergeService } from "../types";

export const localConcierge: ConciergeService = {
  answer: ({ propertySlug, question }) =>
    new Promise((resolve) => {
      const property = properties.find((item) => item.slug === propertySlug);
      if (!property) throw new ServiceError("not-found", "Property not found");
      resolve(answerFor(property, question, properties));
    }),
};
