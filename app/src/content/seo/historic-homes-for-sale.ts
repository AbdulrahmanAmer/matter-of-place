import type { SeoPageContent } from "./types.ts";

/** Collection guide. Brief: historic-homes-for-sale (query "historic homes for sale"). */
export const historicHomesForSale: SeoPageContent = {
  path: "/historic-homes-for-sale",
  kind: "collection",
  query: "historic homes for sale",
  words: [700, 1400],
  title: "Historic Homes for Sale",
  h1: "Historic Homes for Sale",
  description:
    "What makes a home historic, what owners and buyers should know, and how Matter of Place features historic homes in California, New York and Florida.",
  eyebrow: "HISTORIC HOMES",
  lede: "Historic homes for sale are existing houses whose age, builder or past gives them a place in the story of their town or their country. Some are listed on the National Register of Historic Places, some stand in a local historic district, and some carry a documented history with no formal listing at all. This page is a guide to that kind of home in California, New York and Florida: what the words mean, what owners and buyers should know, and how Matter of Place presents such a house.",
  sections: [
    {
      heading: "How it works",
      body: [
        "Matter of Place is an editorial platform, not a brokerage. We do not list houses on this page and we do not represent anyone in a sale. A historic home reaches us because an owner or a listing agent submits it, or because we find it. We read it against our editorial standard, where history sits beside architecture, materiality, craft and setting.",
        "If the house is selected, we research it, write its story and choose the photographs. Specifications come from the listing; history comes from our research. If the house is not selected, nothing is charged, and the answer is not a verdict on the home.",
        "The path is the same for every property: submission, editorial review, acceptance, publication and distribution.",
        { h3: "What historic can mean" },
        {
          list: [
            "National Register of Historic Places: the federal list of places worth preserving, kept by the National Park Service. A listing recognizes a property. On its own it does not restrict what a private owner does with private funds.",
            "Local landmark or historic district: a designation made by a city or a county. It often brings review of exterior changes, and the rules differ from one place to the next.",
            "A documented history without a listing: a house with a known architect, family or event that carries no formal designation. A house can be historic in this sense and stand outside every register.",
          ],
        },
        { h3: "What owners and buyers should know" },
        {
          list: [
            "Owners: gather the record before anything else. Deeds, permits, drawings, surveys, earlier photographs and any letter of designation make a history something a reader can check.",
            "Buyers: ask which designation applies and what it asks of an owner before the house is chosen. Ask for the record of work on the roof, wiring, plumbing and heating.",
            "Both: federal law requires sellers of homes built before 1978 to disclose what they know about lead-based paint, and each state adds its own disclosure rules. Our guide on [how to sell a historic home](/guides/how-to-sell-a-historic-home) sets out the order of work.",
          ],
        },
      ],
    },
    {
      heading: "What you get",
      body: [
        "For an owner or an agent, a Matter of Place feature is an editorial page for the house, written for readers who care about where a home stands and how it was made. It is not an advertisement and it does not promise a result.",
        {
          list: [
            "A dedicated page for the property with a permanent address that search engines can index.",
            "An edited narrative: the house, its history, its architecture and its setting.",
            "Photographs chosen and sequenced for the house.",
            "A social carousel made from the feature.",
            "The agent or brokerage credited by name, with inquiries routed to them directly.",
            "A place in the California, New York or Florida collection.",
          ],
        },
        "The plans and what each one adds are on the [Property Exposure](/exposure) page. Payment does not decide selection, and we do not promise leads, buyers or a sale.",
        "For readers: Place Notes sends selected properties and stories when there is something worth sending. Reading about a house here is not an offer, and an inquiry goes to the representative named on the property.",
      ],
    },
    {
      heading: "Proof: reviews and results",
      body: [
        "There are no client reviews on this page, and none will be written for it. We make no claim about leads, buyers or sales. What we can show is how a home is chosen.",
        "Every property is read against the same list: architecture, design, originality, materiality, setting, history, craft and sense of place. Price is not on the list. A thoughtful two million dollar house may deserve more attention than a generic twenty million dollar one.",
        "The full standard is set out on the [Editorial Standard](/editorial-standard) page.",
      ],
    },
  ],
  faq: [
    {
      q: "What are historic homes for sale?",
      a: "Existing houses whose age, architecture or past gives them a recorded place in the story of their town, whether or not they carry a formal listing. Matter of Place does not list houses for sale on this page. It explains the kind and presents selected homes as editorial features.",
    },
    {
      q: "What do homes with history for sale have in common?",
      a: "A past that can be shown: a named builder or architect, a documented family, a dated change, a place in a street or a district. The record is what separates a house with history from a house that is only old.",
    },
    {
      q: "What are National Register historic homes for sale?",
      a: "Houses listed on the National Register of Historic Places, the federal list kept by the National Park Service. A listing recognizes the property. On its own it does not restrict what a private owner does with private funds, but a local designation on the same house may.",
    },
    {
      q: "Does Matter of Place sell historic homes?",
      a: "No. We are not a brokerage and we represent no one in a sale. Every property credits its representative, and inquiries go to them directly.",
    },
    {
      q: "Does paying guarantee that a home is featured?",
      a: "No. Every property is subject to the Matter of Place editorial standard. A property that is not accepted is not charged.",
    },
    {
      q: "Which states do you cover?",
      a: "California, New York and Florida only, and only existing residential property.",
    },
  ],
  related: [
    { to: "/", anchor: "matter of place" },
    {
      to: "/historic-homes-for-sale-hudson-valley",
      anchor: "historic homes for sale hudson valley",
    },
    { to: "/mid-century-modern-homes", anchor: "mid-century modern homes" },
    { to: "/frank-lloyd-wright-homes", anchor: "frank lloyd wright homes" },
    {
      to: "/architect-designed-homes-for-sale",
      anchor: "architect designed homes for sale",
    },
    {
      to: "/design-focused-homes-for-sale-newsletter",
      anchor: "design focused homes for sale newsletter",
    },
  ],
  cta: {
    heading: "Get started",
    text: "If you own or represent a historic home in California, New York or Florida, submit it for review. Submission is free and we reply either way. If you are reading for the pleasure of it, Place Notes sends selected properties and stories.",
    primary: "submit",
    secondary: "notes",
  },
  schema: ["Service", "FAQPage"],
  published: "2026-10-26",
  updated: "2026-10-26",
};
