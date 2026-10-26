import type { SeoPageContent } from "./types.ts";

/** Collection guide. Brief: submit-a-home-for-sale-to-be-featured (query "submit a home for sale to be featured"). */
export const submitAHomeForSaleToBeFeatured: SeoPageContent = {
  path: "/submit-a-home-for-sale-to-be-featured",
  kind: "collection",
  query: "submit a home for sale to be featured",
  words: [700, 1400],
  title: "Submit a Home for Sale to Be Featured",
  h1: "Submit a Home for Sale to Be Featured",
  description:
    "Submit a home for sale to be featured by Matter of Place: what to send, how editorial review works, and what happens after acceptance.",
  eyebrow: "FOR AGENTS, BROKERAGES & OWNERS",
  lede: "To submit a home for sale to be featured on Matter of Place, send it through the Submit a Property form: the address, the story of the house, the people behind it and your photographs. Every submission is reviewed against our editorial standard before anything else happens. Submission is free, we reply either way, and a home that is not accepted is not charged. This page sets out the whole path, from the form to publication and distribution.",
  sections: [
    {
      heading: "How it works",
      body: [
        "Matter of Place is an editorial platform and no brokerage. It features selected existing homes in California, New York and Florida, and a property is sent in much as work is sent to a magazine. Every property moves through the same stages.",
        {
          steps: [
            "Submission: you send the property and its story through the form.",
            "Editorial review: we read it against our editorial standard.",
            "Acceptance: selected properties are confirmed. Others are not charged.",
            "Exposure: you choose the product that suits the property.",
            "Publication: the property receives its permanent place on the site.",
            "Distribution: the story travels through owned and paid channels.",
          ],
        },
        { h3: "What the form asks for" },
        {
          list: [
            "The property: address, type, price and size, and a link to the listing if there is one.",
            "The story: the architect or designer if known, the year built and renovated, the property story and what makes the home significant.",
            "Your photography, or a link to it, and a video link if you have one.",
            "About you: whether you are an agent or an owner and how to reach you. An agent gives a brokerage and a source link. An owner says whether the home is listed with an agent and names that agent.",
            "Preferred exposure: a preference only. It is confirmed after editorial review and nothing is charged at this stage.",
            "A confirmation that you have the right to share the photography and media.",
          ],
        },
        "Before you send it, gather the record: deeds, drawings, permits, earlier photographs and anything that shows who made the house and when. Specifications come from the listing; history comes from our research, so the more you can show, the more accurate the page will be.",
        { h3: "What we look for" },
        "A reason to stop: a named architect, a considered interior, a house true to its place. We read each home for setting, craft, history, design, architecture, originality, materiality and sense of place. Price does not enter into it. Not every property in California, New York or Florida qualifies, and we do not cover new developments.",
      ],
    },
    {
      heading: "What you get",
      body: [
        "A submission gets a reply. If the home is selected, the result is an editorial page about the house and the ground it stands on, written for a reader who wants more than a listing. The owner or agent pays for a feature, but only after the home is selected; payment does not decide selection, and a feature promises no result.",
        {
          list: [
            "A dedicated page for the property, at a permanent address that search engines can index.",
            "An edited narrative covering the house, its story, its architecture and its setting.",
            "Photographs chosen and sequenced for the home.",
            "A social carousel made from the feature.",
            "The agent or brokerage is named, and inquiries are routed to them.",
            "A place in the California, New York or Florida collection.",
          ],
        },
        "Larger plans carry the story further through Place Notes, our newsletter, through more social distribution and through paid media planning. The plans and what each one adds are on the [Property Exposure](/exposure) page. Paid media budgets are separate from the editorial product fees, and sensitive details of a property can be handled discreetly where appropriate.",
        "We promise no leads, buyers or sale, and a decline is not a verdict on the home.",
      ],
    },
    {
      heading: "Proof: reviews and results",
      body: [
        "No reviews from clients are shown on this page, and none will be written. It makes no claim about leads, buyers or sales, and it gives no count of homes featured, since we hold no figure we could source and date. What we can show is how a home is chosen.",
        "Every property is read against the same eight qualities, and price is not one of them. The [Editorial Standard](/editorial-standard) page sets them out.",
        "Examples of what the standard looks for are in our collections on [homes with history for sale](/historic-homes-for-sale), [mid century modern homes](/mid-century-modern-homes) and [architecturally significant homes for sale](/architect-designed-homes-for-sale).",
      ],
    },
  ],
  faq: [
    {
      q: "How do I submit a home for sale to be featured?",
      a: "Use the Submit a Property form. Send the address, the story of the house, your contact details and your photographs. Every property is reviewed before anything else happens, and we reply either way.",
    },
    {
      q: "Do I have to pay to submit?",
      a: "No. Submission is free. Exposure products apply only after a property is accepted, and payment does not override selection.",
    },
    {
      q: "Who can submit a home?",
      a: "A real estate agent or a property owner. An owner whose home is listed with an agent names that agent in the form.",
    },
    {
      q: "What if my home is not accepted?",
      a: "Nothing is charged. We reply either way, and a no is not a verdict on the home.",
    },
    {
      q: "Does Matter of Place sell homes or represent sellers?",
      a: "No. We are not a brokerage and we act for neither seller nor buyer. Each property credits the representative who handles it, and inquiries go to that person.",
    },
    {
      q: "Where must the home be?",
      a: "In California, New York or Florida, and it must be an existing residential property. We do not currently cover new developments or other places.",
    },
    {
      q: "Can a home stay discreet?",
      a: "Yes. Sensitive property details can be handled discreetly where appropriate.",
    },
  ],
  related: [
    { to: "/", anchor: "matter of place" },
    { to: "/mid-century-modern-homes", anchor: "mid century modern homes" },
    { to: "/historic-homes-for-sale", anchor: "homes with history for sale" },
    {
      to: "/architect-designed-homes-for-sale",
      anchor: "architecturally significant homes for sale",
    },
    {
      to: "/design-focused-homes-for-sale-newsletter",
      anchor: "design focused homes for sale newsletter",
    },
  ],
  cta: {
    heading: "Get started",
    text: "Use the Submit a Property form to put forward a home in California, New York or Florida, as owner or agent; it costs nothing and we reply to every submission. If you would rather read first, Place Notes sends selected properties and stories.",
    primary: "submit",
    secondary: "notes",
  },
  schema: ["Service"],
  published: "2026-10-26",
  updated: "2026-10-26",
};
