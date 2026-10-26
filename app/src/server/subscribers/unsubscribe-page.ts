import { themeHex } from "../../templates/theme.gen";
import { API_PAGE_HEADER } from "../lib/headers";

// The pages of the one-click unsubscribe address (OPS-005) for a reader whose mail client opens it in a browser:
// self-contained, no script, in the brand palette. The one button is a form, so it posts without JavaScript; the
// pipeline hashes the inline style into the page's own policy (`withPageCsp`), and `form-action 'self'` allows the post.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

interface UnsubscribeCopy {
  title: string;
  text: string;
  /** The address the button posts to; no button when absent. */
  action?: string;
}

export const unsubscribeCopy = {
  ask: {
    title: "Unsubscribe",
    text: "Press the button and we will stop sending these emails to this address.",
  },
  done: {
    title: "You are unsubscribed",
    text: "We will send you no more of these emails. Thank you for reading.",
  },
  invalid: {
    title: "This link is not complete",
    text: "Please open the unsubscribe link in the email once more.",
  },
} as const;

function html({ title, text, action }: UnsubscribeCopy): string {
  const button =
    action === undefined
      ? ""
      : `<form method="post" action="${escape(action)}">
<input type="hidden" name="List-Unsubscribe" value="One-Click">
<button type="submit">Unsubscribe</button>
</form>
`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} | Matter of Place</title>
<style>
@font-face { font-family: "Cormorant Garamond"; src: url("/fonts/cormorant-garamond-latin-wght-normal.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
@font-face { font-family: "Jost"; src: url("/fonts/jost-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: ${themeHex.background}; color: ${themeHex.foreground}; font-family: "Jost", system-ui, sans-serif; }
main { max-width: 32rem; padding: 2rem; text-align: center; }
p.eyebrow { font-size: 0.6875rem; letter-spacing: 0.16em; text-transform: uppercase; color: ${themeHex.mutedForeground}; }
h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 400; font-size: clamp(2.5rem, 7vw, 4.5rem); line-height: 1; margin: 1rem 0 1.25rem; }
p { line-height: 1.7; color: ${themeHex.mutedForeground}; }
button { margin-top: 1.5rem; padding: 0.9rem 2rem; border: 0; background: ${themeHex.foreground}; color: ${themeHex.background}; font: inherit; font-size: 0.75rem; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
button:focus-visible { outline: 2px solid ${themeHex.foreground}; outline-offset: 2px; }
</style>
</head>
<body>
<main>
<p class="eyebrow">Matter of Place</p>
<h1>${escape(title)}</h1>
<p>${escape(text)}</p>
${button}</main>
</body>
</html>
`;
}

/** One of the unsubscribe pages, never stored; marked so the API guard lets this one page through (H39 (2)). */
export function unsubscribePage(copy: UnsubscribeCopy, status = 200): Response {
  return new Response(html(copy), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      [API_PAGE_HEADER]: "1",
    },
  });
}
