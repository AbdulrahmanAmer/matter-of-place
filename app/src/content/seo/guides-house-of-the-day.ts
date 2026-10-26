import type { SeoPageContent } from "./types.ts";

/** Article guide. Brief: guides-house-of-the-day (query "house of the day"). */
export const houseOfTheDay: SeoPageContent = {
  path: "/guides/house-of-the-day",
  kind: "guide",
  query: "house of the day",
  words: [900, 2200],
  title: "House of the Day",
  h1: "House of the Day",
  description:
    "House of the day: what the recurring home feature is, how editors choose a home, how to prepare one for consideration, and how Matter of Place differs.",
  eyebrow: "GUIDE",
  lede: "A house of the day is a recurring editorial feature in which a publication presents one home, with photographs and a short text, as a reader's daily or regular pick. It is chosen by editors for what it shows, not assigned by a formula. This guide explains how such features generally work, how a seller or agent can prepare a home to be considered and what to avoid. Matter of Place does not run a daily feature and is not a brokerage. We present selected homes as editorial pages in California, New York and Florida, and we promise no leads, buyers or sales.",
  sections: [
    {
      heading: "The short answer",
      body: [
        "A house of the day is a small, repeating format. A publication shows a single home, usually with a set of photographs, a few paragraphs and the facts a reader wants. Readers return for the pleasure of looking, whether or not they are buying.",
        "Features of this kind tend to reward the same things:",
        {
          list: [
            "a home with a clear point of view: an architect, a material, a setting, a history;",
            "photographs that show the house as it is;",
            "a text that says something specific;",
            "facts that can be checked, and a representative who can answer questions.",
          ],
        },
        "Each publication decides for itself what it chooses and how. Some select on editorial merit alone. Others accept paid placement. Ask the publication which it does, and do not assume.",
      ],
    },
    {
      heading: "What changes the answer",
      body: [
        { h3: "The publication" },
        "A general newspaper, a design magazine and a regional site choose differently, and readers come for different reasons. Read several of its past features before you write to its editors.",
        { h3: "Whether the feature is paid" },
        "Some features are editorial choices. Others are sponsored, and should be identified as such. The question of whether the second kind is worth the cost is covered in [is a sponsored real estate feature worth it](/guides/is-a-sponsored-real-estate-feature-worth-it).",
        { h3: "The home" },
        "Price should not be the reason a home is chosen. What matters is how much the home shows: its architecture, craft, setting and story. A modest house with a strong idea may be a better choice than an expensive house without one.",
        { h3: "The state" },
        "California, New York and Florida each have homes that suit different publications: a mid-century house on a hillside, a stone farmhouse in the Hudson Valley, a coastal house shaped by its climate.",
      ],
    },
    {
      heading: "Step by step",
      body: [
        {
          steps: [
            "Ask what is distinctive about the home. If you cannot say in two sentences, an editor will not either.",
            "Prepare the photographs. Natural light, honest color, and the rooms in the order a visitor would walk them.",
            "Collect the facts: year, architect or builder if known, materials, lot, notable work and any designation. Cite sources for history.",
            "Read the publication and find the right editor or the submission form. Note the formats it already shows.",
            "Write a short, plain note. Say what the home is, why it may interest the readers, and how to reach the representative. Leave out adjectives.",
            "Agree beforehand with your agent or brokerage who will be credited and who will answer inquiries.",
            "Accept a no without argument. An editor's choice is not a verdict on a home.",
          ],
        },
        { h3: "Where Matter of Place fits" },
        "We do not publish a daily feature. We present selected existing homes as permanent editorial pages, and readers can follow them in our collections, such as [hudson valley stone houses for sale](/hudson-valley-stone-houses-for-sale), and in Place Notes, which sends selected properties and stories when there is something worth sending. Submission is free and we reply either way; a no is not a verdict on the home. If you want to see what a feature costs once a property is accepted, the [Property Exposure](/exposure) page lists it, and payment does not override selection. For the wider picture, see [real estate marketing](/guides/real-estate-marketing).",
      ],
    },
    {
      heading: "Common mistakes",
      body: [
        {
          list: [
            "Writing to an editor without reading the publication.",
            "Sending a press release instead of a note. Editors can tell a template.",
            "Photographs of a staged home that does not look like the real one.",
            "Claims of fame or importance with no source.",
            "Treating a feature as a sales channel. It is a presentation, and no feature can promise a buyer.",
            "Following up repeatedly. One polite reminder is enough.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "What is a house of the day?",
      a: "A recurring editorial feature that presents one home at a time, with photographs and a short text, chosen by a publication's editors.",
    },
    {
      q: "How do I get my home considered?",
      a: "Read the publication, prepare honest photographs and checkable facts, and send a short note to the right editor or through its submission form. Whether the home is chosen is the publication's decision.",
    },
    {
      q: "Does price decide which home is chosen?",
      a: "It should not. Architecture, setting, craft and story are better reasons. Our own standard says price is not on the list.",
    },
    {
      q: "Does Matter of Place have a house of the day?",
      a: "No. We do not publish a daily feature. We present selected existing homes as permanent editorial pages and send selected properties through Place Notes.",
    },
    {
      q: "Can I pay to be chosen?",
      a: "Some publications accept paid placement, and should say so. At Matter of Place, payment applies only after a property is accepted and never overrides selection.",
    },
    {
      q: "Does a feature promise a sale?",
      a: "No. A feature gives a home attention and presentation. It guarantees no leads, buyers or sales.",
    },
  ],
  related: [
    { to: "/", anchor: "matter of place" },
    { to: "/guides/real-estate-marketing", anchor: "real estate marketing" },
    {
      to: "/guides/is-a-sponsored-real-estate-feature-worth-it",
      anchor: "is a sponsored real estate feature worth it",
    },
    {
      to: "/hudson-valley-stone-houses-for-sale",
      anchor: "hudson valley stone houses for sale",
    },
  ],
  cta: {
    heading: "Next step",
    text: "If you would like a view on preparing a home for a publication's editors, send a question and we will answer it. A home in California, New York or Florida that you own or represent can also be submitted for review.",
    primary: "contact",
    secondary: "submit",
  },
  schema: ["Article"],
  published: "2026-10-26",
  updated: "2026-10-26",
};
