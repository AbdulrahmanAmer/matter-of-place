import {
  marketGuideSections,
  type MarketDetail,
  type MarketPatch,
  type MarketUpdateInput,
  type RegionInput,
} from "../../domain/admin-markets";
import { regionSlugSchema, type RegionSlug } from "../../domain/market";

// What screen 15's form holds: the fields `PATCH markets/:slug` takes, as text a person edits. Rows that can be moved
// carry a `key` so a row keeps its fields when another is moved past it.

/** A new image waiting for Save: the object name `createStagingUpload` made, and the file's own name. */
interface Staged {
  path: string;
  name: string;
}

export interface RegionValues {
  slug: RegionSlug;
  name: string;
  intro: string;
  /** One place per line. */
  places: string;
  sort_order: string;
  image_url: string | null;
  staged: Staged | null;
}

export interface NoteValues {
  key: string;
  label: string;
  text: string;
}

export interface GuideValues {
  key: string;
  section: string;
  /** A region slug, or the empty string for an entry that belongs to the whole market. */
  region_slug: string;
  label: string;
  text: string;
}

export interface MarketValues {
  name: string;
  intro: string;
  places: string;
  interest_copy: string;
  sort_order: string;
  regions: RegionValues[];
  notes: NoteValues[];
  guide: GuideValues[];
  staged: Staged | null;
}

export const guideSectionLabels: Record<(typeof marketGuideSections)[number], string> = {
  neighborhood: "Neighborhood",
  need: "What clients ask",
  service: "How we work",
};

let counter = 0;
/** A key no other row of this page has had. */
export const newKey = () => {
  counter += 1;
  return `row-${String(counter)}`;
};

const PLACE_BREAK = /\r?\n/;
const placesOf = (text: string) =>
  text
    .split(PLACE_BREAK)
    .map((place) => place.trim())
    .filter((place) => place !== "");

export function valuesOf(market: MarketDetail): MarketValues {
  return {
    name: market.name,
    intro: market.intro,
    places: market.places.join("\n"),
    interest_copy: market.interest_copy ?? "",
    sort_order: String(market.sort_order),
    regions: market.regions.map((region) => ({
      slug: region.slug,
      name: region.name,
      intro: region.intro,
      places: region.places.join("\n"),
      sort_order: String(region.sort_order),
      image_url: region.image_url,
      staged: null,
    })),
    notes: market.notes.map((note) => ({ key: newKey(), ...note })),
    guide: market.guide_entries.map((entry) => ({
      key: newKey(),
      section: entry.section,
      region_slug: entry.region_slug ?? "",
      label: entry.label,
      text: entry.text,
    })),
    staged: null,
  };
}

/** The list with the row at `index` moved by `by` places; a move past either end changes nothing. */
export function moved<Row>(rows: readonly Row[], index: number, by: -1 | 1): Row[] {
  const target = index + by;
  const row = rows[index];
  const other = rows[target];
  if (row === undefined || other === undefined) return [...rows];
  return rows.map((current, at) => {
    if (at === index) return other;
    return at === target ? row : current;
  });
}

const regionInput = (region: RegionValues): RegionInput => ({
  slug: region.slug,
  name: region.name.trim(),
  intro: region.intro.trim(),
  places: placesOf(region.places),
  sort_order: Number(region.sort_order),
  ...(region.staged === null ? {} : { image_staging_path: region.staged.path }),
});

const sameRegion = (saved: RegionValues | undefined, region: RegionValues) =>
  saved !== undefined &&
  region.staged === null &&
  saved.name === region.name &&
  saved.intro === region.intro &&
  saved.places === region.places &&
  saved.sort_order === region.sort_order;

const sameRows = (saved: readonly object[], values: readonly object[], keys: readonly string[]) =>
  saved.length === values.length &&
  saved.every((row, at) => {
    const other = values[at];
    return (
      other !== undefined && keys.every((key) => Reflect.get(row, key) === Reflect.get(other, key))
    );
  });

const NOTE_FIELDS = ["label", "text"] as const;
const GUIDE_FIELDS = ["section", "region_slug", "label", "text"] as const;

/** Whether a number field holds a whole number the API takes. */
export const validOrder = (text: string) => /^\d{1,4}$/.test(text) && Number(text) <= 1000;

/** The market fields of `values` that differ from `saved`, in the shape the API takes. */
function patchOf(saved: MarketValues, values: MarketValues): MarketPatch {
  const patch: MarketPatch = {};
  if (values.name !== saved.name) patch.name = values.name.trim();
  if (values.intro !== saved.intro) patch.intro = values.intro.trim();
  if (values.places !== saved.places) patch.places = placesOf(values.places);
  if (values.interest_copy !== saved.interest_copy) {
    patch.interest_copy = values.interest_copy.trim() === "" ? null : values.interest_copy.trim();
  }
  if (values.sort_order !== saved.sort_order) patch.sort_order = Number(values.sort_order);
  return patch;
}

/**
 * What Save sends: the changed market fields, the regions that changed or got a new image, and the whole notes or
 * guide list when it changed, in the order shown. A part that did not change is left out, so the database leaves it.
 */
export function changesOf(
  saved: MarketValues,
  values: MarketValues,
): Omit<MarketUpdateInput, "slug"> {
  const regions = values.regions.filter(
    (region) =>
      !sameRegion(
        saved.regions.find((before) => before.slug === region.slug),
        region,
      ),
  );
  return {
    patch: patchOf(saved, values),
    ...(regions.length === 0 ? {} : { regions: regions.map(regionInput) }),
    ...(sameRows(saved.notes, values.notes, NOTE_FIELDS)
      ? {}
      : {
          notes: values.notes.map(({ label, text }) => ({
            label: label.trim(),
            text: text.trim(),
          })),
        }),
    ...(sameRows(saved.guide, values.guide, GUIDE_FIELDS)
      ? {}
      : {
          guide_entries: values.guide.flatMap((entry) => {
            const section = marketGuideSections.find((name) => name === entry.section);
            const region = regionSlugSchema.safeParse(entry.region_slug);
            return section === undefined
              ? []
              : [
                  {
                    section,
                    region_slug: region.success ? region.data : null,
                    label: entry.label.trim(),
                    text: entry.text.trim(),
                  },
                ];
          }),
        }),
    ...(values.staged === null ? {} : { image_staging_path: values.staged.path }),
  };
}

/** `values` once they are stored: the images waiting for Save are on their way and no longer waiting. */
export const savedFrom = (values: MarketValues): MarketValues => ({
  ...values,
  staged: null,
  regions: values.regions.map((region) => ({ ...region, staged: null })),
});

/** Whether `changesOf` has anything to send. */
export const isDirty = (saved: MarketValues, values: MarketValues) => {
  const changes = changesOf(saved, values);
  return (
    Object.keys(changes.patch).length > 0 ||
    changes.regions !== undefined ||
    changes.notes !== undefined ||
    changes.guide_entries !== undefined ||
    changes.image_staging_path !== undefined
  );
};

/** Every field Save sends is one the API accepts: a name, an intro, whole-number positions, and labelled rows. */
export function isValid(values: MarketValues): boolean {
  const filled = (...fields: string[]) => fields.every((field) => field.trim() !== "");
  return (
    filled(values.name, values.intro) &&
    validOrder(values.sort_order) &&
    values.regions.every(
      (region) => filled(region.name, region.intro) && validOrder(region.sort_order),
    ) &&
    values.notes.every((note) => filled(note.label, note.text)) &&
    values.guide.every(
      (entry) =>
        filled(entry.label, entry.text) &&
        (entry.section !== "neighborhood" || entry.region_slug !== ""),
    )
  );
}
