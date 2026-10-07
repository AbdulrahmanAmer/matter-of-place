// The cookies this site can set, rendered on /cookies. Changing a row changes COOKIE_INVENTORY_HASH in
// `src/lib/consent.ts`, and the `consent-version` test asks for a raised CONSENT_VERSION, so visitors are asked again.

export type CookieCategory = "necessary" | "analytics";

export type CookieRow = {
  name: string;
  purpose: string;
  provider: string;
  duration: string;
  category: CookieCategory;
};

export const cookieInventory: CookieRow[] = [
  {
    name: "mop_consent",
    purpose: "Remembers your analytics choice.",
    provider: "Matter of Place",
    duration: "12 months",
    category: "necessary",
  },
  {
    name: "__cf_bm",
    purpose: "Tells people from automated traffic.",
    provider: "Cloudflare",
    duration: "30 minutes",
    category: "necessary",
  },
  {
    name: "Turnstile",
    purpose:
      "Checks that a form is sent by a person. Set inside Cloudflare's own frame, only when a form is used.",
    provider: "Cloudflare",
    duration: "Set by Cloudflare",
    category: "necessary",
  },
  {
    name: "sb-<project ref>-auth-token",
    purpose: "Keeps our staff signed in to the admin. Never set for visitors.",
    provider: "Matter of Place",
    duration: "While signed in",
    category: "necessary",
  },
  {
    name: "mop_csrf",
    purpose: "Protects admin forms from forged requests. Never set for visitors.",
    provider: "Matter of Place",
    duration: "12 hours",
    category: "necessary",
  },
  {
    name: "_ga",
    purpose: "Tells one visitor from another when pages are counted.",
    provider: "Google Analytics",
    duration: "2 years",
    category: "analytics",
  },
  {
    name: "_ga_<id>",
    purpose: "Keeps the state of a visit when pages are counted.",
    provider: "Google Analytics",
    duration: "2 years",
    category: "analytics",
  },
];
