// The email redesign's gallery (operator, 2026-10-15): every email we send, drawn and photographed the way a reader
// would see it, twice.
//   bun run scripts/email-gallery.ts [key...]
// Each email is rendered by the code that sends it (`renderTemplate` with the row its definition seeds and the sample
// variables of its key; `renderIssueHtml` for a Place Notes issue; `renderCeoWeekly`; the two Supabase Auth files as
// `build-auth-templates.ts` wrote them), with the public legal identity in the footer. Two copies go to
// out/email-gallery/: `<key>-on.html` loads the artwork, the fonts and a sample photograph from the local files the site
// serves (the live site does not yet answer them cross-origin), as Apple Mail shows a message; `<key>-off.html` loads
// nothing, as Outlook or Gmail with pictures blocked shows it. Headless Edge photographs each at 640 px wide after five
// seconds of virtual time (every motion has finished), the picture is cut at the end of the page, and the PNG goes to
// workspace/08-email-redesign/<key>-on.png and <key>-off.png. The first copy is also drawn at 390 px, the one-column
// layout of a phone, by lib/email-gallery-phone.mjs (Edge's command line cannot open a window that narrow), which
// refuses any sideways scroll and saves <key>-phone.png; lib/email-gallery-motion.mjs lays the opening motion of two
// of them out as frames (motion-<key>.png) and requires that none runs for a reader who asks for less. It prints `<key> <bytes> bytes` for the HTML that is sent and exits 1 when one is
// 100,000 bytes or more (Gmail clips at 102 KB). No database, no key, no network.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ORIGIN = "https://matterofplace.com";
const WIDTH = 640;
const TALL = 6000;
const LIMIT = 100_000;
// The page around the column (Bone): the picture is cut below the last row that holds anything else.
const PAGE = [0xee, 0xea, 0xe1] as const;

const app = fileURLToPath(new URL("..", import.meta.url));
const pages = `${app}out/email-gallery`;
// Edge writes tens of megabytes of profile per launch: the system's temporary folder takes them, not the worktree.
const profiles = join(tmpdir(), "mop-email-gallery-edge");
const shots = fileURLToPath(new URL("../../workspace/08-email-redesign", import.meta.url));

const site: SiteContext = {
  siteUrl: ORIGIN,
  entity: parentCompany,
  address: legalAddress,
  contact: { email: "hello@matterofplace.com" },
};

const local = (path: string): string => pathToFileURL(`${app}${path}`).href;

/** Pictures and fonts from the files the site serves; a sample photograph for every `/media/` address. */
const withLocalFiles = (html: string): string =>
  html
    .replaceAll(`${ORIGIN}/email/`, local("public/email/"))
    .replaceAll(`${ORIGIN}/fonts/`, local("public/fonts/"))
    .replace(/https:\/\/matterofplace\.com\/media\/[^"]+/g, local("src/assets/los-altos.jpg"));

/** No picture and no web font loads: every outside address points at nothing. */
const withNothing = (html: string): string =>
  html
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
}

async function rendered(): Promise<Mail[]> {
  const rows: Mail[] = [];
  for (const { definition } of definitions) {
    const { html } = await renderTemplate(
      definitionRow(definition),
      sampleVariables(definition.key, ORIGIN),
      site,
    );
    rows.push({ key: definition.key, html });
  }
  rows.push({ key: "place_notes", html: await renderIssueHtml(issue, site) });
  rows.push({ key: "ceo_weekly", html: (await renderCeoWeekly(kpis, site)).html });
  for (const [key, file] of [
    ["auth_magic_link", "magic-link"],
    ["auth_invite", "invite"],
  ] as const) {
    rows.push({ key, html: readFileSync(`${app}supabase/templates/${file}.html`, "utf8") });
  }
  return rows;
}

/** The height of the page in a photograph: the last row that is not all Bone, plus the page's own bottom margin. */
async function contentHeight(png: string): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let row = height - 1; row >= 0; row -= 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (row * width + x) * channels;
      const differs = PAGE.some((value, c) => Math.abs((data[at + c] ?? 0) - value) > 2);
      if (differs) return Math.min(height, row + 49);
    }
  }
  return height;
}

/**
 * One headless Edge screenshot. Edge writes the file within seconds and then lingers for about a minute before it exits
 * (measured 2026-10-15: 68 s for one shot), so the process tree is ended as soon as Edge reports the file written.
 * Each shot has a profile folder of its own: one shared by consecutive shots is still locked by the last one's
 * helpers ("Lock file can not be created! Error code: 32"), and a running Edge is never touched.
 */
let shot = 0;
function edgeShot(page: string, png: string): Promise<void> {
  shot += 1;
  return new Promise((resolve, reject) => {
    const edge = spawn(EDGE, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${profiles}/${String(shot)}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=5000",
      `--window-size=${String(WIDTH)},${String(TALL)}`,
      `--screenshot=${png}`,
      pathToFileURL(page).href,
    ]);
    let log = "";
    const end = (error?: Error) => {
      clearTimeout(timer);
      if (edge.pid !== undefined) spawnSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"]);
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => {
      end(new Error(`edge wrote no screenshot in 90 s: ${log}`));
    }, 90_000);
    edge.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      if (/bytes written to file/.test(log)) end();
    });
    edge.on("error", (error) => {
      end(error);
    });
  });
}

async function photograph(html: string, png: string): Promise<void> {
  writeFileSync(`${png}.html`, html);
  await edgeShot(`${png}.html`, `${png}.full.png`);
  const height = await contentHeight(`${png}.full.png`);
  await sharp(`${png}.full.png`)
    .extract({ left: 0, top: 0, width: WIDTH, height })
    .png({ compressionLevel: 9 })
    .toFile(png);
  rmSync(`${png}.full.png`);
  rmSync(`${png}.html`);
}

const only = process.argv.slice(2);
mkdirSync(pages, { recursive: true });
mkdirSync(shots, { recursive: true });
let over = 0;
const drawn: string[] = [];
for (const { key, html } of await rendered()) {
  if (only.length > 0 && !only.includes(key)) continue;
  const bytes = new TextEncoder().encode(html).length;
  if (bytes >= LIMIT) over += 1;
  writeFileSync(`${pages}/${key}.html`, html);
  await photograph(withLocalFiles(html), `${shots}/${key}-on.png`);
  await photograph(withNothing(html), `${shots}/${key}-off.png`);
  writeFileSync(`${pages}/${key}-phone.html`, withLocalFiles(html));
  drawn.push(key);
  console.log(`${key} ${String(bytes)} bytes`);
}
const phone = fileURLToPath(new URL("./lib/email-gallery-phone.mjs", import.meta.url));
const phones = spawnSync("node", [phone, pages, shots, ...drawn], { stdio: "inherit" });
// Two openings as strips of frames, the motion Apple Mail plays: a letter's and the welcome's.
const motion = fileURLToPath(new URL("./lib/email-gallery-motion.mjs", import.meta.url));
const strips = ["received", "newsletter_welcome"]
  .filter((key) => drawn.includes(key))
  .map(
    (key) =>
      spawnSync("node", [motion, `${pages}/${key}-phone.html`, `${shots}/motion-${key}.png`], {
        stdio: "inherit",
      }).status,
  );
// The profiles are scratch; one still held by a closing Edge is left for the next run to sweep.
try {
  rmSync(profiles, { recursive: true, force: true });
} catch {
  console.log(`left ${profiles} to a later run: a closing Edge still holds it`);
}
if (over > 0) console.error(`${String(over)} email(s) at or over ${String(LIMIT)} bytes`);
if (over > 0 || phones.status !== 0 || strips.some((status) => status !== 0)) process.exit(1);
