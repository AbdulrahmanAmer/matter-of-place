// `node scripts/contrast.mjs [tokens.css]`: checks every text and surface token pair the stylesheet draws against the
// 4.5:1 AA ratio and exits 1, one line per failing pair, when one is below it (GOTCHAS G-013). The pairs are the
// ones the components use: body and secondary text on each surface, the inverted button, and the social band.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MINIMUM = 4.5;

/** Text token, surface token. */
const PAIRS = [
  ["--foreground", "--background"],
  ["--foreground", "--secondary"],
  ["--foreground", "--muted"],
  ["--foreground", "--accent"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--secondary"],
  ["--muted-foreground", "--muted"],
  ["--background", "--foreground"],
  ["--primary-foreground", "--primary"],
  ["--social-ink", "--social-band"],
  ["--social-ink-quiet", "--social-band"],
];

/**
 * @param {string} css
 * @returns {Map<string, string>} every custom property of the first `:root` block, by name
 */
function rootTokens(css) {
  const block = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  /** @type {Map<string, string>} */
  const tokens = new Map();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) tokens.set(name, value.trim());
  }
  return tokens;
}

/**
 * @param {Map<string, string>} tokens
 * @param {string} name
 * @returns {number[]} the colour of a token as 0-255 channels, following `var(--other)` aliases
 */
function colour(tokens, name) {
  let value = tokens.get(name);
  for (let hops = 0; value?.startsWith("var(") && hops < 5; hops += 1) {
    value = tokens.get(/var\((--[\w-]+)\)/.exec(value)?.[1] ?? "");
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value ?? "")?.[1];
  if (hex === undefined)
    throw new Error(`${name} is not a six-digit hex colour (${value ?? "missing"})`);
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

/**
 * @param {number[]} rgb
 * @returns {number} WCAG relative luminance
 */
function luminance(rgb) {
  const [red = 0, green = 0, blue = 0] = rgb.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const path = process.argv[2] ?? fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
const tokens = rootTokens(readFileSync(path, "utf8"));
let failures = 0;
for (const [text, surface] of PAIRS) {
  if (text === undefined || surface === undefined) continue;
  const lighter = Math.max(luminance(colour(tokens, text)), luminance(colour(tokens, surface)));
  const darker = Math.min(luminance(colour(tokens, text)), luminance(colour(tokens, surface)));
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const ok = ratio >= MINIMUM;
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? "ok  " : "FAIL"} ${text} on ${surface} ${ratio.toFixed(2)}:1${ok ? "" : ` (needs ${String(MINIMUM)})`}\n`,
  );
}
process.exit(failures === 0 ? 0 : 1);
