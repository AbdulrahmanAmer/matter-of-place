import { describe, expect, it } from "vitest";
import { sampleVariables, type EmailBlock, type EmailTemplateKey } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate, type RenderRow } from "../../../src/server/email/render";
import { definitionRow, definitions } from "../../../src/templates/email/index";

// The shell every email shares since the redesign of 2026-10-15: text first, the house pictured once, motion only for
// a reader who has not asked for less, the film's one italic word, and the brand faces from the site's own origin.

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Omnikom LLC",
  address: "30 N Gould St Ste R, Sheridan, WY 82801, USA",
  contact: { email: "hello@matterofplace.com" },
};

const sample = async (key: EmailTemplateKey) => {
  const file = definitions.find((entry) => entry.definition.key === key);
  if (file === undefined) throw new Error(`no template file for ${key}`);
  return (await renderTemplate(definitionRow(file.definition), sampleVariables(key), site)).html;
};

const row = (body: EmailBlock[]): RenderRow => ({
  key: "received",
  subject: "Subject",
  preheader: "",
  body,
});

const heading = (html: string): string => /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";

describe("the email shell", () => {
  it.each(definitions.map((entry) => entry.definition.key))(
    "%s pictures the house once, in its running header, and names it in the alt text",
    async (key) => {
      const html = await sample(key);
      const pictures = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
      const shell = pictures.filter((tag) => tag.includes("/email/"));
      expect(shell.map((tag) => /\/email\/([\w-]+\.png)/.exec(tag)?.[1])).toEqual([
        "lockup-emblem.png",
        "lockup-wordmark.png",
      ]);
      expect(shell[1]).toContain('alt="Matter of Place"');
      expect(html).not.toMatch(/masthead\.png|ornament\.png|\/email\/emblem\.png/);
    },
  );

  it("keeps every motion inside a reduced-motion query, and starts nothing hidden outside it", async () => {
    const html = await sample("received");
    const query = html.indexOf("@media screen and (prefers-reduced-motion:no-preference){");
    expect(query).toBeGreaterThan(0);
    const keyframes = [...html.matchAll(/@keyframes/g)].map((match) => match.index);
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.every((at) => at > query)).toBe(true);
    // The preheader is hidden on purpose (`display:none`); nothing a reader is meant to see may start hidden.
    const inline = [...html.matchAll(/\bstyle="([^"]*)"/g)]
      .map((match) => match[1] ?? "")
      .filter((style) => !style.includes("display:none"));
    const hides = /(?:^|;)\s*(?:opacity:\s*0|transform:|animation)/;
    expect(inline.filter((style) => hides.test(style))).toEqual([]);
  });

  it("sets a heading's closing lower-case word in italic, and leaves a name or a number in roman", async () => {
    expect(heading(await sample("accepted"))).toBe(
      'Your property has been <em style="font-style:italic">selected.</em>',
    );
    expect(heading(await sample("repermission"))).toBe(
      'Still <em style="font-style:italic">reading?</em>',
    );
    expect(heading(await sample("received"))).toBe("Thank you, Jordan Lee.");
    expect(heading(await sample("invoice"))).toBe("Invoice MOP-0001");
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
    const html = await sample("received");
    expect(html).toContain('<style>@media screen{@font-face{font-family:"Cormorant Garamond";');
    expect(html).toContain(
      "src:url(https://matterofplace.com/fonts/cormorant-garamond-latin-wght-normal.woff2)",
    );
    expect(html).toMatch(/\.mop-serif\{font-family:"Cormorant Garamond",[^}]*!important/);
    expect(html).toMatch(/font-family:Garamond, Georgia, &quot;Times New Roman&quot;, serif/);
  });
});
