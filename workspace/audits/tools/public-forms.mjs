// The public forms of the site, in one table (ruling H79 (6)). Two readers share it and nothing else lists the forms:
// `security.mjs` probes the static routes below for the Turnstile loader, and
// `app/tests/unit/security/turnstile-coverage.test.ts` checks every row against the code. Every public form that
// writes carries Turnstile, with no exception; a form that only reads (search) is exempt by its row, with the reason.
// A new form is a new row: the test refuses a form component that no row names, and a writing row without Turnstile.

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   routes: string[],
 *   api: string | null,
 *   writes: boolean,
 *   turnstile: boolean,
 *   components: string[],
 *   reason?: string,
 *   verifiedIn?: string,
 * }} PublicForm
 * `routes` are the pages that show the form (a `:name` segment is a dynamic route, which the audit cannot fetch),
 * `api` the POST row of `src/server/public/routes.ts` the form sends to, `components` the files under `app/src` that
 * hold the form. A form that writes through a server function instead of a POST row has `api: null` and names the
 * service file that verifies the Turnstile token in `verifiedIn`; its component asks for the token.
 */

/** @type {readonly PublicForm[]} */
export const PUBLIC_FORMS = [
  {
    id: "interest",
    label: "per-market interest signup",
    routes: ["/", "/properties", "/:market", "/:market/:region"],
    api: "/api/public/subscribers",
    writes: true,
    turnstile: true,
    components: ["components/forms/interest-form.tsx"],
  },
  {
    id: "place-notes",
    label: "Place Notes signup",
    routes: ["/place-notes", "/stories"],
    api: "/api/public/subscribers",
    writes: true,
    turnstile: true,
    components: ["components/forms/newsletter-form.tsx"],
  },
  {
    id: "contact",
    label: "contact",
    routes: ["/contact"],
    api: "/api/public/inquiries",
    writes: true,
    turnstile: true,
    components: ["components/forms/contact-form.tsx"],
  },
  {
    id: "property-inquiry",
    label: "inquiry about a property",
    routes: ["/property/:slug"],
    api: "/api/public/inquiries",
    writes: true,
    turnstile: true,
    components: ["components/forms/inquiry-dialog.tsx"],
  },
  {
    id: "submit",
    label: "submit a property",
    routes: ["/submit"],
    api: "/api/public/submissions",
    writes: true,
    turnstile: true,
    components: ["components/forms/submit/wizard.tsx"],
  },
  {
    id: "privacy-request",
    label: "privacy request",
    routes: ["/privacy-request"],
    api: "/api/public/subjects/request",
    writes: true,
    turnstile: true,
    components: ["components/forms/privacy-request-form.tsx"],
  },
  {
    id: "account-sign-in",
    label: "client room sign-in link",
    routes: ["/account"],
    api: null,
    writes: true,
    turnstile: true,
    components: ["components/account/account-sign-in.tsx"],
    verifiedIn: "server/account/service.ts",
  },
  {
    id: "account-confirm",
    label: "client room link confirmation",
    routes: [],
    api: null,
    writes: false,
    turnstile: false,
    components: ["components/account/account-confirm.tsx"],
    reason:
      "exchanges the one-time token of a link already sent for a session; it sends no email and writes no row, and the token is the credential",
  },
  {
    id: "search",
    label: "search",
    routes: ["/properties"],
    api: "/api/public/search",
    writes: false,
    turnstile: false,
    components: [
      "components/search/home-finder.tsx",
      "components/layout/search-overlay.tsx",
    ],
    reason:
      "reads the catalog and writes nothing; the route has its own rate limit",
  },
  {
    id: "not-found-search",
    label: "search on the not-found page",
    routes: [],
    api: null,
    writes: false,
    turnstile: false,
    components: ["components/layout/not-found.tsx"],
    reason:
      "a GET form that navigates to /properties and sends nothing to the API",
  },
];

/**
 * The pages the audit fetches: every static route of the table, once each, in the table's order.
 * @param {readonly PublicForm[]} [forms]
 * @returns {string[]}
 */
export function formPages(forms = PUBLIC_FORMS) {
  return [
    ...new Set(
      forms
        .flatMap((form) => form.routes)
        .filter((route) => !route.includes(":")),
    ),
  ];
}

/**
 * The writing forms the table does not mark as carrying Turnstile.
 * @param {readonly PublicForm[]} [forms]
 * @returns {PublicForm[]}
 */
export function writingFormsWithoutTurnstile(forms = PUBLIC_FORMS) {
  return forms.filter((form) => form.writes && !form.turnstile);
}
