import { formatMoney, formatNumber } from "../../lib/format.ts";
import type { SpecProperty } from "./slides.ts";

/** The text lines every social template draws from the property; the stylesheet sets the capitals. */
export function locationLine(property: SpecProperty): string {
  return `${property.city}, ${property.state}`;
}

/** The price line, or nothing when the spec gives no price (0): a rental or a property whose price is not shown. */
export function priceLine(property: SpecProperty): string {
  return property.price > 0 ? formatMoney(property.price, property.currency) : "";
}

export function specsLine(property: SpecProperty): string {
  const { beds, baths, interiorSqFt } = property;
  return `${formatNumber(beds)} bed · ${formatNumber(baths)} bath · ${formatNumber(interiorSqFt)} sf`;
}
