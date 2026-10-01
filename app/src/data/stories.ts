import tiburon from "../assets/tiburon.jpg";
import palmBeach from "../assets/palm-beach.jpg";
import brooklyn from "../assets/brooklyn.jpg";
import laCourt from "../assets/gallery/desert-court.jpg";
import flLoggia from "../assets/gallery/fl-loggia.jpg";
import hudsonValley from "../assets/hudson-valley.jpg";
import type { Story } from "../domain/story";

/** Illustrative editorial stories. Written to show the format, not reporting. */
export const stories: Story[] = [
  {
    id: "story-01",
    slug: "light-on-the-northern-side-of-the-bay",
    title: "Light on the northern side of the bay.",
    deck: "Why houses in Tiburon and Mill Valley are built for the afternoon.",
    category: "Places",
    market: "california",
    image: tiburon,
    body: [
      "North of the Golden Gate, fog decides the morning and the sun decides the afternoon. The better houses in Marin are planned around that turn.",
      "Terraces face west and south. Living rooms sit a half level up to catch light over the trees. Bedrooms stay quiet and cool on the hillside.",
      "It is a simple idea, followed carefully. The result is a house that feels different at four o'clock than it did at nine.",
    ],
    properties: ["tiburon-waterline", "marin-ridge"],
    publishedAt: "2026-09-10",
  },
  {
    id: "story-02",
    slug: "shade-as-a-material",
    title: "Shade as a material.",
    deck: "From Palm Beach loggias to a Miami pavilion, coolness as architecture.",
    category: "Architecture",
    market: "florida",
    image: flLoggia,
    body: [
      "Before air conditioning, Florida houses were designed to keep the sun out and let the breeze in. Loggias, deep eaves and shuttered openings did the work.",
      "The houses worth attention today still use those tools. Shade is placed, not added. Courtyards are sized to hold cool air.",
      "Palm Beach keeps the Mediterranean version. Miami and Fort Lauderdale lean modern. The principle is the same.",
    ],
    properties: ["palm-beach-estate", "south-florida-pavilion"],
    publishedAt: "2026-09-02",
  },
  {
    id: "story-03",
    slug: "the-brownstone-parlor",
    title: "The brownstone parlor floor.",
    deck: "What a restored Brooklyn parlor keeps, and what it quietly lets go.",
    category: "Interiors",
    market: "new-york",
    image: brooklyn,
    body: [
      "The parlor floor was built for show: tall windows, plaster ceilings, pocket doors between two rooms.",
      "Good restorations keep the proportion and the light. They let go of the formality. The rooms become a place to live rather than to receive.",
    ],
    properties: ["brooklyn-heights-brownstone", "west-village-townhouse"],
    publishedAt: "2026-08-24",
  },
  {
    id: "story-04",
    slug: "courtyards-of-the-westside",
    title: "Courtyards of the Westside.",
    deck: "Los Angeles houses that turn inward, and why it works.",
    category: "Architecture",
    market: "california",
    image: laCourt,
    body: [
      "The Los Angeles courtyard house is older than the freeway. It borrows from Spanish and Mediterranean plans and adapts them to a dry climate.",
      "Rooms open to a shared center rather than to the street. Privacy comes from the plan, not from a hedge.",
    ],
    properties: ["la-courtyard"],
    publishedAt: "2026-08-15",
  },
  {
    id: "story-05",
    slug: "stone-houses-of-the-hudson",
    title: "Stone houses of the Hudson.",
    deck: "Dutch farmhouses that have outlasted three centuries of weather.",
    category: "Stories",
    market: "new-york",
    image: hudsonValley,
    body: [
      "The early stone houses of the Hudson Valley were built from what was near: fieldstone, oak and lime.",
      "The best of them have been restored with patience. Thick walls, low ceilings and small windows remain. Kitchens and baths change; the house does not.",
    ],
    properties: ["hudson-valley-stone-farmhouse"],
    publishedAt: "2026-08-04",
  },
  {
    id: "story-06",
    slug: "palm-beach-without-the-postcard",
    title: "Palm Beach, without the postcard.",
    deck: "The island's quieter streets and the houses that suit them.",
    category: "Places",
    market: "florida",
    image: palmBeach,
    body: [
      "Away from Worth Avenue, Palm Beach is a place of hedges, bicycles and very little noise.",
      "The houses that belong here are modest from the street and generous behind the wall.",
    ],
    properties: ["palm-beach-estate"],
    publishedAt: "2026-07-22",
  },
];
