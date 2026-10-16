import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleVariables, type EmailBlock, type EmailTemplateKey } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate, type RenderRow } from "../../../src/server/email/render";
import type { KpiWeek } from "../../../src/server/kpi/definitions";
import { renderIssueHtml } from "../../../src/server/newsletter/render";
import { renderCeoWeekly } from "../../../src/templates/email/ceo-weekly";
import { definitionRow, definitions } from "../../../src/templates/email/index";

// The three houses of 2026-10-15 (operator: "use all of the designs directions ... based on the type of the email"):
// Threshold for the moments, Afternoon for correspondence, Threshold's light variant for internal mail. One house:
// the same faces and colophon everywhere, the door idea at the top of each, text first, motion only for a reader who
// has not asked for less, and the film's one italic word.

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Omnikom LLC",
  address: "30 N Gould St Ste R, Sheridan, WY 82801, USA",
  contact: { email: "hello@matterofplace.com" },
};

type House = "threshold" | "afternoon" | "light";

/** Every email and its house, as the operator grouped them: all twenty-one, each in exactly one. */
const HOUSE_OF: Record<string, House> = {
  received: "threshold",
  accepted: "threshold",
  awaiting_assets: "threshold",
  newsletter_welcome: "threshold",
  account_link: "threshold",
  newsletter_confirm: "threshold",
  interest_confirm: "threshold",
  market_open: "threshold",
  inquiry_ack: "threshold",
  auth_magic_link: "threshold",
  auth_invite: "threshold",
  invoice: "afternoon",
  place_notes: "afternoon",
  standalone: "afternoon",
  declined: "afternoon",
  subject_ack: "afternoon",
  repermission: "afternoon",
  admin_notify: "light",
  ceo_weekly: "light",
  campaign_report: "light",
  inquiry_forward: "light",
};

/** The picture each house opens on. */
const DOOR: Record<House, string> = {
  threshold: "door-night.gif",
  afternoon: "door-day.gif",
  light: "lockup-emblem.png",
};

const sample = async (key: EmailTemplateKey) => {
  const file = definitions.find((entry) => entry.definition.key === key);
  if (file === undefined) throw new Error(`no template file for ${key}`);
  return renderTemplate(definitionRow(file.definition), sampleVariables(key), site);
};

const week = (start: string, end: string): KpiWeek => ({
  week_start: start,
  week_end: end,
  submissions_received: 4,
  decisions: { accepted: 2, declined: 1 },
  time_to_decision_hours: 18,
  invoices: { issued: 2, issued_amount: 990, paid: 1, paid_amount: 295 },
  properties_published: 2,
  posts_by_channel: { instagram: 3, linkedin: 2, x: 3 },
  newsletter: { confirmed: 9, unsubscribed: 1, net: 8, total_confirmed: 164 },
  inquiries: { received: 6, published_properties: 2, top: [] },
});

/** The HTML of every email we send, drawn by the code that sends it. */
async function html(key: string): Promise<string> {
  switch (key) {
    case "place_notes":
      return renderIssueHtml(
        {
          number: 4,
          subject: "Place Notes No. 4",
          preheader: "",
          blocks: [{ id: "i", type: "intro", text: "Two homes this fortnight." }],
        },
        site,
      );
    case "ceo_weekly":
      return (
        await renderCeoWeekly(
          { current: week("2026-10-05", "2026-10-11"), previous: week("2026-09-28", "2026-10-04") },
          site,
        )
      ).html;
    case "auth_magic_link":
    case "auth_invite":
      return readFileSync(
        new URL(
          `../../../supabase/templates/${key === "auth_invite" ? "invite" : "magic-link"}.html`,
          import.meta.url,
        ),
        "utf8",
      );
    default: {
      const file = definitions.find((entry) => entry.definition.key === key);
      if (file === undefined) throw new Error(`no template file for ${key}`);
      return (await sample(file.definition.key)).html;
    }
  }
}

const pictures = (page: string): string[] =>
  [...page.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes("/email/"));

const fileOf = (tag: string): string => /\/email\/([\w-]+\.(?:png|gif|jpg))/.exec(tag)?.[1] ?? "";

const row = (body: EmailBlock[]): RenderRow => ({
  key: "received",
  subject: "Subject",
  preheader: "",
  body,
});

describe("the three houses", () => {
  it("holds every email the operator grouped, each in exactly one house", () => {
    const keyed = definitions.map((entry) => entry.definition.key);
    const all = [...keyed, "place_notes", "ceo_weekly", "auth_magic_link", "auth_invite"];
    expect(new Set(all).size).toBe(21);
    expect(Object.keys(HOUSE_OF).sort()).toEqual([...all].sort());
  });

  it.each(Object.entries(HOUSE_OF))(
    "%s opens on the door of its house and closes on the shared colophon",
    async (key, house) => {
      const page = await html(key);
      const files = pictures(page).map(fileOf);
      expect(files[0]).toBe(DOOR[house]);
      expect(files.slice(-2)).toEqual(["wordmark-obsidian.png", "wordmark-bone.png"]);
      const door = pictures(page)[0] ?? "";
      expect(door).toContain(house === "light" ? 'alt=""' : 'alt="Matter of Place"');
      // The colophon is the same words in every house.
      expect(page).toContain(
        "Exceptional property. Properly considered. California, New York and Florida.",
      );
      expect(page).toContain(">matterofplace.com</a>");
      expect(page).toContain("Omnikom LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA");
    },
  );

  it("swaps Afternoon's door for its night still only in Apple Mail's dark mode, and hides it from Outlook", async () => {
    const page = await html("invoice");
    const night = pictures(page).find((tag) => tag.includes("door-day-dark.png")) ?? "";
    expect(night).toMatch(/class="[^"]*mop-dm/);
    expect(night).toMatch(/display:none/);
    expect(night).toMatch(/mso-hide:all/);
    expect(pictures(page).find((tag) => tag.includes("door-day.gif"))).toMatch(
      /class="[^"]*mop-lm/,
    );
    expect(page).toContain(".mop-lm{display:none!important}");
    expect(page).toContain('<meta name="color-scheme" content="light dark"/>');
  });

  it("keeps the light house free of Threshold's dark cinema: no Obsidian band, no door GIF", async () => {
    for (const key of ["admin_notify", "campaign_report", "inquiry_forward", "ceo_weekly"]) {
      const page = await html(key);
      expect(page).not.toMatch(/door-(?:night|day)\.gif/);
      const bands = [
        ...page.matchAll(/<td\b[^>]*style="[^"]*background-color:#11110f[^"]*"[^>]*>/g),
      ].map(([tag]) => tag);
      // The one Obsidian surface a light email may have is a button.
      expect(bands.filter((tag) => !tag.includes("mop-btn"))).toEqual([]);
    }
  });
});

describe("Threshold", () => {
  it("passes the opening through the door: the first line enters above it, the second leaves below", async () => {
    const page = (await sample("received")).html;
    const body = page.slice(page.indexOf("<body"));
    const enters = body.indexOf("412 Alder Court");
    const door = body.indexOf("door-night.gif");
    const leaves = body.indexOf("is with the");
    expect(enters).toBeGreaterThan(0);
    expect(enters).toBeLessThan(door);
    expect(door).toBeLessThan(leaves);
    expect(body).toContain(">In review</td>");
    expect(body).toContain(">Pasadena · California</td>");
  });

  it("sets the record shot's stack: the counter, then the steps, the current one in italic", async () => {
    const page = (await sample("received")).html;
    expect(page).toContain("02 / 03");
    const steps = ["Received.", "In review.", "A decision."].map((step) =>
      page.indexOf(`>${step}</span>`),
    );
    expect(steps.every((at) => at > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(page).toMatch(
      /font-style:italic[^>]*><span class="mop-m"><span class="mop-r mop-d1">In review\./,
    );
    expect((await sample("accepted")).html).toContain("03 / 03");
  });

  it("cuts to the other paper at every statement: the record on Warm Ivory, the rule on Obsidian", async () => {
    const page = (await sample("received")).html;
    const record = page.indexOf("Thank you for sending it to us.");
    // After the record: the preheader says the same words before the body.
    const rule = page.indexOf("Review comes before", record);
    const ivory = page.lastIndexOf("background-color:#f5f2eb", record);
    const obsidian = page.lastIndexOf("background-color:#11110f", rule);
    expect(ivory).toBeGreaterThan(0);
    expect(obsidian).toBeGreaterThan(record);
  });
});

describe("Afternoon", () => {
  it("sets the invoice's amounts as an exact ledger under the placard, and says them first in the text part", async () => {
    const { html: page, text } = await sample("invoice");
    expect(page).toContain(">Invoice MOP-0001</p>");
    expect(page).toMatch(/<th scope="col"[^>]*>Item<\/th>/);
    expect(page).toMatch(/<th scope="col"[^>]*>Amount<\/th>/);
    expect(page).toMatch(/<th scope="row"[^>]*>Total due<\/th>/);
    expect(page.match(/>\$295\.00</g)).toHaveLength(2);
    expect(page).toContain("tabular-nums");
    expect(page.indexOf("Total due")).toBeLessThan(page.indexOf("November 4, 2026"));
    expect(page).toContain(">November 18, 2026</span></td>");
    expect(
      text.startsWith(
        "Invoice MOP-0001\n\nThe Feature, 412 Alder Court: $295.00\n\nTotal due: $295.00\n\n",
      ),
    ).toBe(true);
  });

  it("hangs the opening on the centre axis: the title, then the subtitle in italic", async () => {
    const page = (await sample("invoice")).html;
    const title = page.indexOf(">The Feature</span>");
    const subtitle = page.indexOf(">for 412 Alder Court</span>");
    expect(title).toBeGreaterThan(0);
    expect(subtitle).toBeGreaterThan(title);
    expect(page.slice(page.lastIndexOf("<p", subtitle), subtitle)).toContain("font-style:italic");
  });
});

describe("the shared shell", () => {
  it("keeps every motion inside a reduced-motion query, and starts nothing hidden outside it", async () => {
    const page = (await sample("received")).html;
    const query = page.indexOf("@media screen and (prefers-reduced-motion:no-preference){");
    expect(query).toBeGreaterThan(0);
    const keyframes = [...page.matchAll(/@keyframes/g)].map((match) => match.index);
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.every((at) => at > query)).toBe(true);
    // The preheader and a dark-mode picture are hidden on purpose (`display:none`); nothing a reader is meant to see may
    // start hidden.
    const inline = [...page.matchAll(/\bstyle="([^"]*)"/g)]
      .map((match) => match[1] ?? "")
      .filter((style) => !style.includes("display:none"));
    const hides = /(?:^|;)\s*(?:opacity:\s*0|transform:|animation)/;
    expect(inline.filter((style) => hides.test(style))).toEqual([]);
  });

  it("sets a heading's closing lower-case word in italic, and leaves a name or a number in roman", async () => {
    expect((await sample("received")).html).toContain(
      'is with the <em style="font-style:italic">editors.</em>',
    );
    expect((await sample("accepted")).html).toContain(
      'is <em style="font-style:italic">accepted.</em>',
    );
    expect((await sample("repermission")).html).toContain(
      'Still <em style="font-style:italic">reading?</em>',
    );
    const invoice = (await sample("invoice")).html;
    expect(invoice).toContain(">The Feature</span>");
    expect(invoice).not.toContain('<em style="font-style:italic">Feature');
    // A sentence that ends on a name keeps it in roman: the word that carries it cannot be told there.
    const named = (
      await renderTemplate(row([{ type: "heading", text: "Welcome, Jordan Lee." }]), {}, site)
    ).html;
    expect(named).toContain("Welcome, Jordan Lee.");
    expect(named).not.toContain('<em style="font-style:italic">Lee.</em>');
  });

  it("draws no name for a signature without words, and a signature's own words as the last line", async () => {
    const letter: EmailBlock[] = [{ type: "paragraph", text: "We have your note." }];
    const bare = await renderTemplate(row(letter), {}, site);
    const signed = await renderTemplate(row([...letter, { type: "signature" }]), {}, site);
    expect(signed.html).toBe(bare.html);
    expect(signed.text).toContain("Matter of Place");
    const named = await renderTemplate(
      row([...letter, { type: "signature", text: "Jordan Lee, for the editors" }]),
      {},
      site,
    );
    expect(named.html).toMatch(/>Jordan Lee, for the editors<\/p>/);
  });

  it("names the brand faces on the site's own origin, inside a media block that Outlook skips", async () => {
    const page = (await sample("received")).html;
    expect(page).toContain('<style>@media screen{@font-face{font-family:"Cormorant Garamond";');
    expect(page).toContain(
      "src:url(https://matterofplace.com/fonts/cormorant-garamond-latin-wght-normal.woff2)",
    );
    expect(page).toMatch(/\.mop-serif\{font-family:"Cormorant Garamond",[^}]*!important/);
    expect(page).toMatch(/font-family:Garamond, Georgia, &quot;Times New Roman&quot;, serif/);
  });

  it("gives every picture its size and the colour of its paper, so its place reads with pictures off", async () => {
    for (const key of Object.keys(HOUSE_OF)) {
      for (const tag of [...(await html(key)).matchAll(/<img\b[^>]*>/g)].map(([found]) => found)) {
        expect(tag).toMatch(/\bwidth="\d+"/);
        expect(tag).toMatch(/background-color:#[0-9a-f]{6}/);
      }
    }
  });
});
