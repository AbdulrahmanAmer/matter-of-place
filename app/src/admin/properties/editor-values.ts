import type { PropertyFields, PropertyPatch, PropertyRecord } from "../../domain/admin-properties";

// What screen 8's fields hold: every field `PATCH properties/:id` takes, read from the row.

export type EditorValues = Omit<PropertyFields, "editorial_state">;

export type EditFields = (fields: Partial<PropertyPatch>) => void;

export function valuesOf(row: PropertyRecord): EditorValues {
  return {
    slug: row.slug,
    title: row.title,
    region_slug: row.region_slug,
    city: row.city,
    neighborhood: row.neighborhood,
    country: row.country,
    address: row.address,
    price: row.price,
    beds: row.beds,
    baths: row.baths,
    interior_sq_ft: row.interior_sq_ft,
    lot_acres: row.lot_acres,
    year_built: row.year_built,
    type: row.type,
    style: row.style,
    architect: row.architect,
    designer: row.designer,
    status: row.status,
    story: row.story,
    place: row.place,
    representative_id: row.representative_id,
    presented_by_owner: row.presented_by_owner,
    listing_url: row.listing_url,
  };
}

/**
 * An empty box is null, never zero or an empty string, so a cleared field reads as missing on the checklist. Text pasted
 * from a listing ("$4,200,000", "1,200,000") loses its dollar sign, commas and spaces before it is read.
 */
export const numberOrNull = (text: string): number | null => {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
};

/** Text in the box that is not empty and still not a number ("4.2M", "3 bd"): the field keeps its last good value. */
export const isUnreadableNumber = (text: string): boolean =>
  text.trim() !== "" && numberOrNull(text) === null;

export const unreadableNumberMessage = "Enter a number, for example 1200000.";

export const textOrNull = (text: string): string | null => (text.trim() === "" ? null : text);
