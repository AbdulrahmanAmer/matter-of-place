/**
 * Localisation table for shared chrome and notices.
 *
 * English is the only locale in V1 and there is deliberately no language
 * switcher. A second locale is added by supplying another table with the same
 * keys. Editorial copy inside property and market data is authored per record
 * and is not part of this table.
 */
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
    terms: "Terms",
    instagram: "Instagram",
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
  },
  footer: {
    groups: {
      place: "Matter of Place",
      editorial: "Editorial",
      professionals: "For Professionals",
      company: "Company",
    },
    statement:
      "Matter of Place is an independent real-estate media and distribution platform focused on exceptional residential property in California, New York and Florida.",
    line: "An Omnikom company.",
  },
  common: {
    illustrative: "ILLUSTRATIVE",
    illustrativeImagery: "ILLUSTRATIVE IMAGERY",
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
    /** Shown beneath every form while the API is not configured. */
    localNotice: "Delivery opens with the live service. Until then, nothing leaves this device.",
    /** Confirmation while the API is not configured. */
    localSent: "Delivery opens with the live service, so this stays with you for now.",
    /** Confirmation once the API is configured. */
    liveSent: "A person will reply within one working day.",
    error: "This did not go through. Please try once more.",
    invalid: "Please check the highlighted details.",
  },
  newsletter: {
    eyebrow: "A NOTE FROM US",
    title: "Place Notes",
    text: "Selected properties and stories from California, New York and Florida.",
    localSent:
      "Thank you. Place Notes opens with the live service; your address stays with you for now.",
    liveSent: "Thank you. Place Notes will reach you when the next letter is ready.",
  },
} as const;

export type Strings = typeof en;

const tables: Record<Locale, Strings> = { en };

/** Returns the string table for a locale (English until other tables exist). */
function getStrings(locale: Locale = defaultLocale): Strings {
  return tables[locale];
}

/** Convenience accessor for the default locale. */
export const t = getStrings();
const x: number = "a";
