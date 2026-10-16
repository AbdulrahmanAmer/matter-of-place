// The gallery of the email houses (operator, 2026-10-15: Threshold, Afternoon and Threshold's light variant): every
// email we send, drawn by the code that sends it and photographed the way a reader would see it.
//   bun run scripts/email-gallery.ts [key...]
// Each email is rendered as it is sent (`renderTemplate` with the row its definition seeds and the sample variables of
// its key, with the public legal identity; `renderIssueHtml` for a Place Notes issue; `renderCeoWeekly`; the two
// Supabase Auth files as `build-auth-templates.ts` wrote them) and checked by the email lint. Three copies go to
// out/email-gallery/: `<key>.html` is what is sent; `<key>-on.html` loads the pictures, the fonts and a sample
// photograph from the files the site serves, with each door GIF shown at its last frame (the designed state a reader
// sees once it has played); `<key>-off.html` loads nothing, as Outlook or Gmail with pictures blocked shows it.
// lib/email-gallery-shots.mjs photographs them in the installed Edge through Playwright (Node: Playwright cannot start a
// browser from Bun here, P-3513) into workspace/08-email-redesign/v2/: `<key>-desktop.png` in an 800 px reading pane,
// `<key>-phone.png` on a 375 px phone, `<key>-imagesoff.png`, and refuses any sideways scroll. The two GIFs are copied
// beside them and index.html shows every email by house. It prints `<key> <bytes> bytes` and exits 1 when an email is
// 100,000 bytes or more (Gmail clips at 102 KB) or has a lint finding. No database, no key, no network.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { legalAddress, parentCompany } from "../src/config/legal-identity.ts";
import { sampleVariables } from "../src/domain/email.ts";
import type { SiteContext } from "../src/server/email/context.ts";
import { renderTemplate } from "../src/server/email/render.ts";
import type { WeeklyKpis } from "../src/server/kpi/collect.ts";
import type { KpiWeek } from "../src/server/kpi/definitions.ts";
import { renderIssueHtml, type RenderIssue } from "../src/server/newsletter/render.ts";
import { renderCeoWeekly } from "../src/templates/email/ceo-weekly.tsx";
import { definitionRow, definitions } from "../src/templates/email/index.ts";
import { lintEmail } from "./lib/email-lint.ts";

const ORIGIN = "https://matterofplace.com";
const LIMIT = 100_000;

const app = fileURLToPath(new URL("..", import.meta.url));
const pages = join(app, "out/email-gallery");
const shots = fileURLToPath(new URL("../../workspace/08-email-redesign/v2", import.meta.url));

/** The house of every email (operator, 2026-10-15), in the order the index shows them. */
const HOUSES = [
  {
    name: "Threshold",
    kind: "Moments: something happened.",
    keys: [
      "received",
      "accepted",
      "awaiting_assets",
      "newsletter_welcome",
      "account_link",
      "newsletter_confirm",
      "interest_confirm",
      "market_open",
      "inquiry_ack",
      "auth_magic_link",
      "auth_invite",
    ],
  },
  {
    name: "Afternoon",
    kind: "Correspondence: a letter from us.",
    keys: ["invoice", "place_notes", "standalone", "declined", "subject_ack", "repermission"],
  },
  {
    name: "Threshold light",
    kind: "Internal mail, read several times a day.",
    keys: ["admin_notify", "ceo_weekly", "campaign_report", "inquiry_forward"],
  },
] as const;

const site: SiteContext = {
  siteUrl: ORIGIN,
  entity: parentCompany,
  address: legalAddress,
  contact: { email: "hello@matterofplace.com" },
};

const local = (path: string): string => pathToFileURL(join(app, path)).href;

/** The door GIFs at their last frame: the state a reader sees once a GIF has played, and the state Gmail rests on. */
async function stills(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  mkdirSync(join(pages, "stills"), { recursive: true });
  for (const name of ["door-night", "door-day"]) {
    const gif = join(app, `public/email/${name}.gif`);
    const { pages: frames = 1 } = await sharp(gif).metadata();
    const png = join(pages, "stills", `${name}.png`);
    await sharp(gif, { page: frames - 1 })
      .png()
      .toFile(png);
    out[`${ORIGIN}/email/${name}.gif`] = pathToFileURL(png).href;
  }
  return out;
}

// A full-page photograph is taken at once, so every picture loads at once: a lazy one far down the page would be blank.
const eager = (html: string): string => html.replaceAll(' loading="lazy"', "");

/** Pictures and fonts from the files the site serves; a sample photograph for every `/media/` address. */
const withLocalFiles = (html: string, rest: Record<string, string>): string =>
  Object.entries(rest)
    .reduce((page, [from, to]) => page.replaceAll(from, to), eager(html))
    .replaceAll(`${ORIGIN}/email/`, local("public/email/"))
    .replaceAll(`${ORIGIN}/fonts/`, local("public/fonts/"))
    .replace(/https:\/\/matterofplace\.com\/media\/[^"]+/g, local("src/assets/los-altos.jpg"));

/** No picture and no web font loads: every outside address points at nothing. */
const withNothing = (html: string): string =>
  eager(html)
    .replaceAll(`${ORIGIN}/email/`, local("out/email-gallery/blocked/"))
    .replaceAll(`${ORIGIN}/fonts/`, local("out/email-gallery/blocked/"))
    .replace(
      /https:\/\/matterofplace\.com\/media\/[^"]+/g,
      local("out/email-gallery/blocked/x.jpg"),
    );

function week(weekStart: string, weekEnd: string, overrides: Partial<KpiWeek> = {}): KpiWeek {
  return {
    week_start: weekStart,
    week_end: weekEnd,
    submissions_received: 4,
    decisions: { accepted: 2, declined: 1 },
    time_to_decision_hours: 18,
    invoices: { issued: 2, issued_amount: 990, paid: 1, paid_amount: 295 },
    properties_published: 2,
    posts_by_channel: { instagram: 3, linkedin: 2, x: 3 },
    newsletter: { confirmed: 9, unsubscribed: 1, net: 8, total_confirmed: 164 },
    inquiries: {
      received: 6,
      published_properties: 2,
      top: [
        { slug: "alder-court", title: "Alder Court", count: 3 },
        { slug: "oak-hill-residence", title: "Oak Hill Residence", count: 2 },
      ],
    },
    ...overrides,
  };
}

const kpis: WeeklyKpis = {
  current: week("2026-10-05", "2026-10-11"),
  previous: week("2026-09-28", "2026-10-04", { submissions_received: 2, properties_published: 1 }),
};

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const issue: RenderIssue = {
  number: 4,
  subject: "Place Notes No. 4: The house that keeps the afternoon",
  preheader: "A Spanish Revival house in Pasadena, and a street of oaks.",
  blocks: [
    {
      id: "intro",
      type: "intro",
      text: "Two homes this fortnight, both in California, and one street we keep returning to.",
    },
    {
      id: "p1",
      type: "property",
      property_id: id(1),
      asset_id: id(2),
      title: "Alder Court",
      deck: "A 1926 Spanish Revival house in Pasadena, kept close to how it was built.",
      text: "Newly published.",
      slug: "alder-court",
      image_key: "sample/alder-court/og.jpg",
      image_url: `${ORIGIN}/media/sample/alder-court/og.jpg`,
      link: `${ORIGIN}/property/alder-court`,
    },
    {
      id: "s1",
      type: "story",
      story_id: id(3),
      title: "The house that keeps the afternoon",
      deck: "How a low roof and a deep porch hold the light of a Pasadena afternoon.",
      slug: "the-house-that-keeps-the-afternoon",
    },
  ],
};

interface Mail {
  key: string;
  html: string;
  text: string;
}

async function rendered(): Promise<Mail[]> {
  const rows: Mail[] = [];
  for (const { definition } of definitions) {
    const { html, text } = await renderTemplate(
      definitionRow(definition),
      sampleVariables(definition.key, ORIGIN),
      site,
    );
    rows.push({ key: definition.key, html, text });
  }
  rows.push({ key: "place_notes", html: await renderIssueHtml(issue, site), text: "Place Notes" });
  const weekly = await renderCeoWeekly(kpis, site);
  rows.push({ key: "ceo_weekly", html: weekly.html, text: weekly.text });
  for (const [key, file] of [
    ["auth_magic_link", "magic-link"],
    ["auth_invite", "invite"],
  ] as const) {
    rows.push({
      key,
      html: readFileSync(join(app, `supabase/templates/${file}.html`), "utf8"),
      text: "",
    });
  }
  return rows;
}

const houseOf = (key: string) =>
  HOUSES.find((house) => (house.keys as readonly string[]).includes(key));

function index(drawn: readonly string[], bytes: ReadonlyMap<string, number>): string {
  const card = (key: string) => `
      <figure>
        <figcaption><b>${key}</b> <span>${String(bytes.get(key) ?? 0)} bytes</span></figcaption>
        <div class="row">
          <a href="${key}-desktop.png"><img src="${key}-desktop.png" alt="${key} on a desktop" loading="lazy"></a>
          <a href="${key}-phone.png"><img src="${key}-phone.png" alt="${key} on a phone" loading="lazy"></a>
          <a href="${key}-imagesoff.png"><img src="${key}-imagesoff.png" alt="${key} with pictures off" loading="lazy"></a>
        </div>
      </figure>`;
  const sections = HOUSES.map(
    (house) => `
    <section>
      <h2>${house.name}</h2>
      <p>${house.kind}</p>
      ${house.keys
        .filter((key) => drawn.includes(key))
        .map(card)
        .join("")}
    </section>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Matter of Place emails, by house</title>
<style>
  body{margin:0;padding:40px;background:#eeeae1;color:#11110f;font:15px/1.5 Georgia,serif}
  h1{font-weight:400;font-size:34px;margin:0 0 6px} h2{font-weight:400;font-size:28px;margin:48px 0 0}
  p{margin:0 0 18px;color:#575751} .doors{display:flex;gap:32px;align-items:flex-start;margin:20px 0}
  .doors figure{margin:0} .doors img{display:block;width:600px;max-width:100%;border:1px solid #c9c0b2}
  figure{margin:28px 0} figcaption{font:12px/1.4 Arial,sans-serif;letter-spacing:.08em;margin:0 0 8px}
  figcaption span{color:#575751} .row{display:flex;gap:16px;align-items:flex-start}
  .row a:nth-child(1) img{width:400px} .row a:nth-child(2) img{width:188px} .row a:nth-child(3) img{width:400px}
  .row img{display:block;border:1px solid #c9c0b2}
</style></head>
<body>
  <h1>Matter of Place emails, by house</h1>
  <p>Each email drawn by the code that sends it, with sample variables: desktop (800 px pane), phone (375 px), and with
  pictures and web fonts blocked. The doors are shown at their last frame; the GIFs themselves are below.</p>
  <div class="doors">
    <figure><img src="door-night.gif" alt="Threshold's door, at night"><figcaption>Threshold: door-night.gif</figcaption></figure>
    <figure><img src="door-day.gif" alt="Afternoon's door, by day"><figcaption>Afternoon: door-day.gif</figcaption></figure>
  </div>${sections}
</body></html>
`;
}

const only = process.argv.slice(2);
mkdirSync(pages, { recursive: true });
mkdirSync(shots, { recursive: true });
const rest = await stills();
let failed = 0;
const drawn: string[] = [];
const bytes = new Map<string, number>();
for (const { key, html, text } of await rendered()) {
  if (only.length > 0 && !only.includes(key)) continue;
  if (houseOf(key) === undefined) throw new Error(`${key} has no house`);
  const size = new TextEncoder().encode(html).length;
  const findings = text === "" || key === "place_notes" ? [] : lintEmail(html, text, key);
  if (size >= LIMIT || findings.length > 0) failed += 1;
  bytes.set(key, size);
  writeFileSync(join(pages, `${key}.html`), html);
  writeFileSync(join(pages, `${key}-on.html`), withLocalFiles(html, rest));
  writeFileSync(join(pages, `${key}-off.html`), withNothing(html));
  drawn.push(key);
  console.log(
    `${key} ${String(size)} bytes${findings.map((finding) => ` ${finding.rule}: ${finding.message}`).join("")}`,
  );
}
const shooter = fileURLToPath(new URL("./lib/email-gallery-shots.mjs", import.meta.url));
const photographed = spawnSync("node", [shooter, pages, shots, ...drawn], { stdio: "inherit" });
for (const name of ["door-night.gif", "door-day.gif"]) {
  copyFileSync(join(app, "public/email", name), join(shots, name));
}
writeFileSync(join(shots, "index.html"), index(drawn, bytes));
if (failed > 0)
  console.error(`${String(failed)} email(s) over ${String(LIMIT)} bytes or with a lint finding`);
if (failed > 0 || photographed.status !== 0) process.exit(1);
