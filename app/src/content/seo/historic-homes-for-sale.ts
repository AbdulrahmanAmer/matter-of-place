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
  lede: "Historic homes for sale are existing houses whose age, builder or past gives them a place in the story of their town or their country. Some are listed on the National Register of Historic Places, some stand in a local historic district, and some carry a documented history with no formal listing at all. Read on for what the terms mean in California, New York and Florida, what owners and buyers should know, and the way Matter of Place presents a historic house.",
  sections: [
    {
      heading: "How it works",
      body: [
        "Matter of Place is an editorial platform, and no house described here can be bought through us. We act for no seller and no buyer. A historic house arrives when its owner or listing agent sends it in, or when our editors come across it, and we read it for its past first, then for the architecture, materials, craft and setting that carry that past.",
        "A selected house is researched and written up by us, and we choose its photographs. The listing supplies the specifications and our research supplies the history. A house we do not select is not charged for, and that answer says nothing against the home itself.",
        "In order, a historic house goes through submission, editorial review, acceptance, exposure, publication and distribution. Exposure is the step where the owner or agent picks a plan, and it comes only after acceptance.",
        { h3: "What historic can mean" },
        {
          list: [
            "National Register of Historic Places: the federal list of places worth preserving, kept by the National Park Service. A listing recognizes a property. On its own it does not restrict what a private owner does with private funds.",
            "Local landmark or historic district: a designation made by a city or a county. It often means review of changes to the outside, and the rules differ from one place to the next.",
            "A documented history without a listing: a house with a known architect, family or event that carries no formal designation. A house can be historic in this sense and stand outside every register.",
          ],
        },
        { h3: "What owners and buyers should know" },
        {
          list: [
            "Owners: gather the record before anything else. Deeds, permits, drawings, surveys, earlier photographs and any letter of designation make a history something a reader can check.",
            "Buyers: find out which designation applies and what it would ask of you before the house is chosen. Ask for the record of work on the roof, wiring, plumbing and heating.",
            "Both: for a house built before 1978, federal law makes the seller disclose known lead-based paint, and every state adds disclosure rules of its own. Our guide on [how to sell a historic home](/guides/how-to-sell-a-historic-home) sets out the order of work.",
          ],
        },
      ],
    },
    {
      heading: "What you get",
      body: [
        "A feature on a historic house is an editorial page for readers who care about where a home stands and what its past was. The owner or agent pays for a feature, and only after the house has been selected.",
        {
          list: [
            "A page of its own for the house, at a permanent address that search engines can index.",
            "An edited narrative that puts the history first, then the architecture and the setting.",
            "Photographs chosen and sequenced to show what has survived of the original house.",
            "A social carousel made from the feature.",
            "Credit to the agent or brokerage by name, with inquiries sent straight to them.",
            "A place in the California, New York or Florida collection.",
          ],
        },
        "Each plan and what it adds is listed on the [Property Exposure](/exposure) page. Paying for a plan never decides selection, and no plan promises leads, buyers or a sale.",
        "Readers can follow selected houses through Place Notes, which goes out only when a house or story merits it. A house described in a note is not an offer, and inquiries go to the representative named on its page.",
      ],
    },
    {
      heading: "Proof: reviews and results",
      body: [
        "This page carries no client reviews and no results, because none exist for it and we would not write them. Leads, buyers and sales are not claimed anywhere on it. What we can show is how a historic house is chosen.",
        "Every property is read against the same list: architecture, design, originality, materiality, setting, history, craft and sense of place. Price is not on the list. A thoughtful two million dollar house may deserve more attention than a generic twenty million dollar one.",
        "The full standard is set out on the [Editorial Standard](/editorial-standard) page.",
      ],
    },
  ],
  faq: [
    {
      q: "What are historic homes for sale?",
      a: "Existing houses whose age, architecture or past gives them a recorded place in the story of their town, whether or not they carry a formal listing. Nothing on this page is for sale. It describes the kind, and the houses we select are shown as editorial features.",
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
      a: "No. We are not a brokerage and act for no one in a sale. Each historic house credits its own representative, and inquiries go to that person.",
    },
    {
      q: "Does paying guarantee that a home is featured?",
      a: "No. A historic house has to meet the editorial standard before a plan is even discussed, and one that is declined is not charged.",
    },
    {
      q: "Which states do you cover?",
      a: "California, New York and Florida, and only houses that already exist.",
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
