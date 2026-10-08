import { describe, expect, it } from "vitest";
import {
  checklistItems,
  factFields,
  publishChecklist,
  type PropertyMedia,
  type PropertyRecord,
} from "../../src/domain/admin-properties";

// B7 invariant 8: the publish checklist of screen 8. Each item fails alone, and "Facts complete" names every empty
// field the public page needs (G62).

type Checked = Parameters<typeof publishChecklist>[0];

const complete: Checked = {
  region_slug: "bay-area",
  neighborhood: "Sea Cliff",
  country: "United States",
  price: 4_200_000,
  beds: 4,
  baths: 3.5,
  interior_sq_ft: 3400,
  lot_acres: 0.3,
  year_built: 1931,
  style: "Mediterranean",
  place: "A street above the water.",
  hero_image: "o/sea-cliff/1-0a1b2c3d.webp",
  story: ["The first paragraph.", "The second paragraph."],
  status: "Active",
  presented_by_owner: false,
};

const photo = (n: number, alt: string | null = `Room ${String(n)}`): PropertyMedia => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  media_key: `o/sea-cliff/${String(n)}-0a1b2c3d.webp`,
  staging_path: null,
  alt,
  orientation: "landscape",
  sort_order: n,
});

const six = [1, 2, 3, 4, 5, 6].map((n) => photo(n));
const agent = { id: "00000000-0000-4000-8000-0000000000aa" };

const failing = (property: Checked, media = six, representative: typeof agent | null = agent) =>
  publishChecklist(property, media, representative)
    .filter((item) => !item.passed)
    .map((item) => item.id);

describe("publishChecklist", () => {
  it("passes every item on a complete property", () => {
    expect(failing(complete)).toEqual([]);
    expect(publishChecklist(complete, six, agent).map((item) => item.label)).toEqual(
      checklistItems.map((item) => item.label),
    );
  });

  it("fails the hero alone when there is no hero image", () => {
    expect(failing({ ...complete, hero_image: null })).toEqual(["hero"]);
  });

  it("fails the images alone with five photographs with alt text, or a sixth without", () => {
    expect(failing(complete, six.slice(0, 5))).toEqual(["images"]);
    expect(failing(complete, [...six.slice(0, 5), photo(6, "  ")])).toEqual(["images"]);
    expect(failing(complete, [...six.slice(0, 5), { ...photo(6), media_key: null }])).toEqual([
      "images",
    ]);
  });

  it("fails the narrative alone with one paragraph that is not blank", () => {
    expect(failing({ ...complete, story: ["Only one.", "  "] })).toEqual(["narrative"]);
  });

  it("fails the facts alone and names every empty field", () => {
    const result = publishChecklist({ ...complete, style: null, lot_acres: null }, six, agent);
    expect(result.filter((item) => !item.passed).map((item) => item.id)).toEqual(["facts"]);
    expect(result.find((item) => item.id === "facts")?.missing).toEqual(["lot_acres", "style"]);
  });

  it("lists exactly the null fields of a draft made from a request (G62)", () => {
    // create_property_from_submission leaves these null; the agent left the lot and the year empty too.
    const draft: Checked = {
      ...complete,
      region_slug: null,
      neighborhood: null,
      lot_acres: null,
      style: null,
      place: null,
      year_built: null,
      hero_image: null,
    };
    const facts = publishChecklist(draft, [], agent).find((item) => item.id === "facts");
    expect(facts?.missing).toEqual([
      "region_slug",
      "neighborhood",
      "lot_acres",
      "year_built",
      "style",
      "place",
    ]);
    expect(factFields).not.toContain("hero_image");
  });

  it.each([
    ["Active", true],
    ["Under offer", true],
    ["Off-market", false],
    ["Sold", false],
    ["Illustrative", false],
  ] as const satisfies readonly (readonly [PropertyRecord["status"], boolean])[])(
    "a %s listing with no representative fails representation: %s",
    (status, fails) => {
      expect(failing({ ...complete, status }, six, null)).toEqual(fails ? ["representation"] : []);
    },
  );

  it("a live listing presented by the owner passes with no representative (S55)", () => {
    expect(failing({ ...complete, presented_by_owner: true }, six, null)).toEqual([]);
  });
});
