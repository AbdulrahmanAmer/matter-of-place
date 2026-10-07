import { themeHex } from "../../templates/theme.gen";

/**
 * The 503 page of `maintenanceGate`: self-contained, no script, in the brand palette. Its one inline style is
 * hashed into its own policy header; the faces are static files, which keep answering while the gate is on.
 */
export const maintenanceHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>A short pause | Matter of Place</title>
<style>
@font-face { font-family: "Cormorant Garamond"; src: url("/fonts/cormorant-garamond-latin-wght-normal.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
@font-face { font-family: "Jost"; src: url("/fonts/jost-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: ${themeHex.background}; color: ${themeHex.foreground}; font-family: "Jost", system-ui, sans-serif; }
main { max-width: 32rem; padding: 2rem; text-align: center; }
p.eyebrow { font-size: 0.6875rem; letter-spacing: 0.16em; text-transform: uppercase; color: ${themeHex.mutedForeground}; }
h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 400; font-size: clamp(2.5rem, 7vw, 4.5rem); line-height: 1; margin: 1rem 0 1.25rem; }
p { line-height: 1.7; color: ${themeHex.mutedForeground}; }
</style>
</head>
<body>
<main>
<p class="eyebrow">Matter of Place</p>
<h1>A short pause</h1>
<p>We are making a small change to the site. Please come back in a few minutes.</p>
</main>
</body>
</html>
`;
