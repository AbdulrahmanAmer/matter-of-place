import type { ExposurePackage } from "../../domain/rows.ts";
import type { Offering } from "../../domain/exposure.ts";
import { offerings } from "../../data/exposure.ts";
import { AppError } from "../lib/errors.ts";

const DOLLARS = /^\$(\d{1,3}(?:,\d{3})*)$/;

/** The offering named like the product. `Not sure yet` has none: it is resolved to a real product before an invoice. */
export function offeringFor(product: ExposurePackage): Offering {
  const offering = offerings.find((candidate) => candidate.name === product);
  if (offering === undefined) {
    throw new AppError("validation", undefined, "Choose a product before issuing an invoice.");
  }
  return offering;
}

/** Whole dollars from the display price of `src/data/exposure.ts`, the only price source (S3). */
export function priceFor(product: ExposurePackage): number {
  const offering = offeringFor(product);
  const dollars = DOLLARS.exec(offering.price)?.[1];
  if (dollars === undefined) {
    throw new AppError(
      "server",
      undefined,
      `The price of ${offering.name} is not a dollar amount.`,
    );
  }
  return Number(dollars.replaceAll(",", ""));
}
