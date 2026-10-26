import type { SeoPageContent } from "./types.ts";

/** Article guide. Brief: guides-how-to-sell-a-historic-home (query "how to sell a historic home"). */
export const howToSellAHistoricHome: SeoPageContent = {
  path: "/guides/how-to-sell-a-historic-home",
  kind: "guide",
  query: "how to sell a historic home",
  words: [900, 2200],
  title: "How to Sell a Historic Home?",
  h1: "How to Sell a Historic Home?",
  description:
    "How to sell a historic home: find out what applies to it, gather the record, disclose what you know and tell its story with sources.",
  eyebrow: "GUIDE",
  lede: "How to sell a historic home comes down to knowing exactly what makes it historic and what that asks of the next owner. Confirm any designation, easement or preservation agreement and have the paperwork ready. Disclose what you know about the condition of an older building. Let the history be told with sources rather than adjectives. Matter of Place is not a brokerage and cannot sell the house for you; this guide sets out the order of work, and the rules named in it vary by state, city and property.",
  sections: [
    {
      heading: "The short answer",
      body: [
        "A historic home is sold like any other home, through a licensed agent and a contract, and what changes is the preparation. Buyers of an older house want to know three things before they want to see it again: what protects it, what it needs, and what is true about its past.",
        {
          list: [
            "Know what applies: a National Register listing, a local landmark or district designation, a preservation easement or a tax agreement.",
            "Keep the record: deeds, permits, drawings, surveys, earlier photographs and the history of repairs.",
            "Disclose what you know, in the form your state asks for.",
            "Tell the history with its sources, and leave out what cannot be shown.",
          ],
        },
      ],
    },
    {
      heading: "What changes the answer",
      body: [
        "Three things change what you do first.",
        { h3: "The kind of protection" },
        "A listing on the National Register of Historic Places recognizes a property and, on its own, does not restrict what a private owner does with private funds. A local designation, such as a landmark or a house inside a historic district, often brings review of exterior changes, and the rules differ from one city or county to the next. Our guide to [historic homes for sale](/historic-homes-for-sale) explains the terms in more detail.",
        { h3: "What is attached to the deed" },
        "A preservation or facade easement can bind every later owner. So can a preservation contract with a city or county; California's Mills Act contracts are an example. Ask for the documents and read them before the house goes to market, because a buyer's attorney will.",
        { h3: "The state" },
        "Disclosure rules differ. California sellers complete a Transfer Disclosure Statement. New York sellers either complete a Property Condition Disclosure Statement or give the buyer a credit in its place. In Florida, a seller must tell the buyer about known facts that materially affect the value of the home and are not readily observable. For a home built before 1978, federal law also requires disclosure of what the seller knows about lead-based paint. Confirm the current rules with your attorney, since they change.",
      ],
    },
    {
      heading: "Step by step",
      body: [
        {
          steps: [
            "Find out what applies. Ask the local preservation office, read the title and look for a designation letter, an easement or a contract.",
            "Gather the record. Deeds, permits, drawings, surveys, earlier photographs and invoices for major work turn a story into a history.",
            "Look at the house as a buyer will. An inspection of the roof, wiring, plumbing, heating and foundation tells you what to repair, what to disclose and what to leave as it is.",
            "Prepare the disclosures with your attorney, in the form your state asks for.",
            "Choose a representative who has handled houses of this kind. Ask to see examples, and ask how they will explain the designation to a buyer.",
            "Write the history with its sources. Say who built the house, when it changed and what is original, and say so only where you can show it.",
            "Present the house to readers who look for this kind of home. Owners and agents in California, New York and Florida can [submit a property](/submit) to Matter of Place for review. We reply either way, and a no is not a verdict on the home.",
          ],
        },
      ],
    },
    {
      heading: "Common mistakes",
      body: [
        {
          list: [
            "Assuming the designation does not matter, or that it settles everything. Both cost sellers time once a buyer's attorney reads the file.",
            "Starting work before asking the preservation office. In a designated house, exterior changes may need review, and work done without it can follow the property to the next owner.",
            "Naming a famous architect or owner without a source. A claim that cannot be checked weakens the claims that can.",
            "Leaving the paper record until the buyer asks for it.",
            "Hiding what you know about the condition of an older building. The disclosure rules of each state exist for this, and following them protects the seller.",
            "Treating age as the whole story. A house is read for its architecture, materials, craft and setting as much as its date.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "Does a historic home sell differently from other homes?",
      a: "The sale itself follows the same steps. The preparation differs: the designation, any easement or agreement, the record of the house and the condition of older systems all need to be ready before a buyer asks.",
    },
    {
      q: "Can I change a historic home before I sell it?",
      a: "It depends on the designation. A local landmark or district often requires review of exterior work, and a preservation easement can limit changes permanently. Ask the local preservation office before work starts.",
    },
    {
      q: "What must I disclose when I sell?",
      a: "Each state sets its own rules, and federal law adds one for lead-based paint in homes built before 1978. Your attorney can confirm what applies to your sale.",
    },
    {
      q: "Do I need an agent who has sold historic homes?",
      a: "The law does not require it, and it helps. Ask for examples of similar houses and how the agent explained their designation and condition.",
    },
    {
      q: "Will Matter of Place sell my historic home?",
      a: "No. We are not a brokerage and represent no one in a sale. We can consider the home for an editorial feature, and every property credits its representative.",
    },
    {
      q: "Does a feature guarantee interest or a sale?",
      a: "No. A feature gives the house an editorial page and a place in front of readers. We guarantee no leads, buyers or sales.",
    },
  ],
  related: [
    { to: "/", anchor: "matter place" },
    { to: "/guides/real-estate-marketing", anchor: "real estate marketing" },
    {
      to: "/guides/is-a-sponsored-real-estate-feature-worth-it",
      anchor: "is a sponsored real estate feature worth it",
    },
    {
      to: "/historic-homes-for-sale",
      anchor: "national register historic homes for sale",
    },
    {
      to: "/historic-homes-for-sale-hudson-valley",
      anchor: "historic homes for sale hudson valley",
    },
    {
      to: "/guides/how-to-sell-an-architecturally-significant-home",
      anchor: "how to sell an architecturally significant home",
    },
  ],
  cta: {
    heading: "Next step",
    text: "If a question here is yours, send it and we will answer it. If you own or represent a historic home in California, New York or Florida, you can also submit it for review.",
    primary: "contact",
    secondary: "submit",
  },
  schema: ["Article"],
  published: "2026-10-26",
  updated: "2026-10-26",
};
