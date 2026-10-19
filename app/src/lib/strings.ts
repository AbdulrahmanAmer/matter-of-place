/**
 * Localisation table for shared chrome and notices.
 *
 * English is the only locale in V1 and there is deliberately no language
 * switcher. A second locale is added by supplying another table with the same
 * keys. Editorial copy inside property and market data is authored per record
 * and is not part of this table.
 */
import { productLine } from "../config/legal-identity";

export type Locale = "en";

export const defaultLocale: Locale = "en";

/** Text direction per locale; consumed by the root <html> element. */
export const localeDirection: Record<Locale, "ltr" | "rtl"> = { en: "ltr" };

const en = {
  nav: {
    properties: "Properties",
    california: "California",
    newYork: "New York",
    florida: "Florida",
    stories: "Stories",
    standard: "Editorial Standard",
    submit: "Submit a Property",
    about: "About",
    exposure: "Property Exposure",
    faq: "FAQ",
    contact: "Contact",
    privacy: "Privacy",
    terms: "Terms for Professionals",
    accessibility: "Accessibility",
    accessibilitySettings: "Accessibility settings",
    doNotSell: "Do Not Sell or Share",
    instagram: "Instagram",
    x: "X",
    linkedin: "LinkedIn",
  },
  header: {
    home: "Matter of Place home",
    search: "Search properties",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    closeSearch: "Close search",
    findAPlace: "FIND A PLACE",
    searchPlaceholder: "Where would you like to look?",
    searchLabel: "Search location or property",
    openMarkets: "California · New York · Florida",
    tagline: "Exceptional property. Properly considered.",
    skipToContent: "Skip to content",
  },
  footer: {
    groups: {
      place: "Matter of Place",
      editorial: "Editorial",
      professionals: "For Professionals",
      company: "Company",
    },
    line: productLine,
    product: "{name} is a product of {entity}.",
  },
  common: {
    illustrative: "ILLUSTRATIVE",
    exploreProperties: "Explore properties",
    subscribe: "Subscribe",
    emailAddress: "Email address",
    requestShowing: "Request showing",
    ask: "Ask",
    send: "Send",
    sending: "Sending",
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    continue: "Continue",
  },
  forms: {
    thankYou: "Thank you.",
    /** Above Cloudflare's box when it asks the visitor to confirm they are a person (src/lib/turnstile.ts). */
    turnstileAsk: "One more step: tick the box below to confirm you are a person.",
    /** Shown beneath every form while the API is not configured. */
    localNotice: "Delivery opens with the live service. Until then, nothing leaves this device.",
    /** Confirmation while the API is not configured. */
    localSent: "Delivery opens with the live service, so this stays with you for now.",
    /** Confirmation once the API is configured. */
    liveSent: "A person will reply within one working day.",
    /** Directly above the send button of the two inquiry forms (B15 invariant 1). */
    sharedWithOmnikom: "We share your message with Omnikom, which operates Matter of Place.",
    error: "This did not go through. Please try once more.",
    invalid: "Please check the highlighted details.",
    /** Beside a field the browser found empty or malformed when the form was sent. */
    fieldRequired: "Please fill in this field.",
    fieldInvalid: "Please check this entry.",
    /** Under an email field whose domain looks like a typo (W9 item 1): "Did you mean ann@gmail.com?" */
    emailTypo: "Did you mean",
    emailTypoUse: "Use {address}",
    /** When the details were refused but none of them is a field the form shows (the submit wizard). */
    invalidUnplaced: "Some of the details were not accepted. Please look through each step.",
    /** Beside a field of the submit wizard that was refused, by what was wrong with it. */
    issue: {
      choose: "Please choose one.",
      tooLong: "Please shorten this entry.",
      zip: "Please enter a five-digit ZIP.",
      link: "Please enter a full link, starting with https://.",
      email: "Please enter a valid email address.",
      price: "Please enter an amount above zero.",
      beds: "Please enter a whole number, zero or more.",
      squareFeet: "Please enter a whole number above zero.",
      zeroOrMore: "Please enter zero or more.",
      year: "Please enter a year from 1600 to 2100.",
      rights: "Please confirm you have the rights.",
      photographs: "Please check the photographs.",
    },
    /** The title of the list on the Review step, and one line of it: the field, its step (from 1) and what to do. */
    reviewIssues: "Still to look at",
    issueLine: (field: string, step: number, message: string) =>
      `${field} on step ${String(step)}: ${message}`,
    /** A received submission whose photographs are still going out (FE-04). */
    uploading: (done: number, total: number) =>
      `Received. Uploading ${String(done)} of ${String(total)} photographs.`,
    uploadDone: "Received, with every photograph.",
    uploadFailed: (count: number) =>
      count === 1 ? "1 photograph did not upload." : `${String(count)} photographs did not upload.`,
    uploadRetry: "Retry",
  },
  newsletter: {
    eyebrow: "A NOTE FROM US",
    title: "Place Notes",
    text: "Selected properties and stories from California, New York and Florida.",
    localSent:
      "Thank you. Place Notes opens with the live service; your address stays with you for now.",
    liveSent: "Thank you. Check your inbox to confirm.",
    confirmed: "Thank you. Your address is confirmed.",
    confirmFailed: "This link has expired or was already used. Subscribe again below.",
  },
  home: {
    intro:
      "Matter of Place is an editorial publication for exceptional existing residential property in California, New York and Florida. We choose each home for what it is, present it with an editor's care and give it a permanent page. Price never decides what we publish.",
  },
  comingSoon: {
    eyebrow: "OPENING SOON",
    home: {
      title: "The first properties are being considered.",
      text: "We publish only what we have reviewed and accepted. Nothing is listed yet. Leave your email and we will write when the first property is published.",
    },
    properties: {
      title: "No property is listed yet.",
      text: "Every property here will have been reviewed and accepted by our editors. Tell us where you are looking and we will write when the first one is published.",
    },
    market: {
      title: "No property is listed in {market} yet.",
      text: "The {market} desk is reading the market and reviewing what agents send us. We will write when the first {market} property is published.",
    },
    region: {
      title: "No property is listed in {region} yet.",
      text: "The first {market} properties will appear here and on the {market} page. Leave your email and we will write when they do.",
    },
    stories: {
      title: "Stories arrive with the first properties.",
      text: "We write about a place once we have properly considered it. Leave your email and we will write when the first story is published.",
    },
    form: {
      legend: "Where are you looking?",
      submit: "Tell me when it opens",
      note: "We will only write about this.",
      sentMarket:
        "Thank you. We will write when the first {market} property is published. Please confirm from the email we send.",
      sentAny:
        "Thank you. We will write when the first property is published. Please confirm from the email we send.",
    },
    badge: "Opening soon",
    cardLine: "Hear when it opens",
    meta: {
      properties:
        "No property is listed yet. Leave your email to hear when the first one is published.",
      market: "{intro} No property is listed in {market} yet.",
    },
    illustrative: {
      title: "What is real here",
      text: "The properties shown on this site are illustrative. They show how a dossier reads. None is for sale through Matter of Place and none is a real listing.",
      link: "Read our editorial standard",
      label: "ILLUSTRATIVE PREVIEW",
    },
  },
  consent: {
    label: "Cookie notice",
    title: "Cookies",
    text: "May we count visits with Google Analytics? It sets cookies. Saying no changes nothing.",
    accept: "Allow",
    decline: "No, thank you",
    link: "Privacy policy",
    change: "Cookie settings",
  },
  privacyRequest: {
    title: "Privacy request",
    eyebrow: "PRIVACY",
    heading: "Ask about your information",
    intro:
      "Tell us what you would like and where to write back. We confirm receipt by email and reply within 45 days.",
    kindLegend: "What would you like?",
    kinds: {
      access: "Know what you hold about me",
      deletion: "Delete my information",
      opt_out: "Do not sell or share",
      correction: "Correct my information",
    },
    emailLabel: "Email address",
    noteLabel: "Anything we should know (optional)",
    confirmation:
      "We received your request. A confirmation is on its way to your email. We will reply within 45 days.",
  },
  privacyChoices: {
    title: "Privacy choices",
    on: "Analytics are on.",
    off: "Analytics are off.",
    none: "You have not chosen yet.",
  },
  privacy: {
    cookiesLink: "The full list of cookies is on the Cookies page.",
  },
  cookies: {
    title: "Cookies",
    intro:
      "These are the cookies this site can set. Necessary cookies are always on. Analytics cookies are set only after you allow them.",
  },
  errors: {
    reference: "Reference",
  },
  notFound: {
    searchLabel: "Search properties",
  },
} as const;

export type Strings = typeof en;

const tables: Record<Locale, Strings> = { en };

/** Fills `{name}` placeholders from `values`; a placeholder with no value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | undefined>>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Returns the string table for a locale (English until other tables exist). */
function getStrings(locale: Locale = defaultLocale): Strings {
  return tables[locale];
}

/** Convenience accessor for the default locale. */
export const t = getStrings();
