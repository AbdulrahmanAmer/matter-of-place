import { describe, expect, it } from "vitest";
import type { SiteContext } from "../../../src/server/email/context";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { loadBlocks, type StoredIssue } from "../../../src/server/newsletter/issue";
import {
  renderIssueHtml,
  renderPreview,
  type RenderIssue,
} from "../../../src/server/newsletter/render";
import { themeHex } from "../../../src/templates/theme.gen";
import type { Db } from "../../../src/server/lib/db";
import { newsletterDb, propertyBlock, storyBlock, uuid } from "../../fixtures/newsletter-world";

// The issue the editor previews and the subscriber reads (B11 step 5): one renderer, links finished, footer complete.

const UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Stub Entity LLC",
  address: "1 Stub Street, New York, NY",
  contact: { email: null },
};

const picture = {
  image_key: "oak-hill/og.jpg",
  image_url: "https://matterofplace.com/media/oak-hill/og.jpg",
  link: "https://matterofplace.com/property/oak-hill?utm_source=newsletter&utm_medium=social&utm_campaign=newsletter",
};

const issue: RenderIssue = {
  number: 4,
  subject: "Place Notes No. 4: Under the oaks",
  preheader: "A quiet street.",
  blocks: [
    { id: "intro", type: "intro", text: "First line.\nSecond line." },
    { ...storyBlock(1, "Under the oaks", "A quiet street."), slug: "under-the-oaks" },
    { ...propertyBlock(3, "Oak Hill", "A quiet house."), slug: "oak-hill", ...picture },
    { ...storyBlock(2, "The long view", "A second look."), slug: "the-long-view" },
  ],
};

const decode = (value: string): string => value.replaceAll("&amp;", "&");

const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => decode(match[1] ?? ""));

describe("renderIssueHtml", () => {
  it("keeps Resend's unsubscribe variable as the unsubscribe link", async () => {
    const html = await renderIssueHtml(issue, site);
    expect(html).toContain(`href="${UNSUBSCRIBE}"`);
    expect(html).toMatch(/>Unsubscribe<\/a>/);
  });

  it("gives every other link the UTM set, with the issue number and the slug of its block", async () => {
    const links = hrefs(await renderIssueHtml(issue, site)).filter((href) => href !== UNSUBSCRIBE);
    expect(links).toEqual([
      "https://matterofplace.com/stories/under-the-oaks?utm_source=place_notes&utm_medium=email&utm_campaign=issue-4&utm_content=under-the-oaks",
      "https://matterofplace.com/property/oak-hill?utm_source=place_notes&utm_medium=email&utm_campaign=issue-4&utm_content=oak-hill",
      "https://matterofplace.com/stories/the-long-view?utm_source=place_notes&utm_medium=email&utm_campaign=issue-4&utm_content=the-long-view",
    ]);
  });

  it("shows the legal entity and the postal address of the site context", async () => {
    const html = await renderIssueHtml(issue, site);
    expect(html).toContain("Stub Entity LLC");
    expect(html).toContain("1 Stub Street, New York, NY");
    const bare = await renderIssueHtml(issue, { ...site, entity: null, address: null });
    expect(bare).not.toContain("Stub Entity LLC");
    expect(bare).not.toContain("null");
  });

  it("draws the masthead, the intro lines and the stories in reading order", async () => {
    const html = await renderIssueHtml(issue, site);
    const order = [
      "Place Notes",
      "No. 4",
      "First line.",
      "Second line.",
      "Under the oaks",
      "Oak Hill",
      "The long view",
      "Unsubscribe",
    ].map((text) => html.indexOf(text, html.indexOf("<body")));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("<title>Place Notes No. 4: Under the oaks</title>");
  });

  it("has no em dash and takes every inline colour from the theme", async () => {
    const html = await renderIssueHtml(issue, site);
    expect(html).not.toContain("—");
    const declared = [
      ...html.matchAll(
        /[;"]\s*(?:color|background(?:-color)?|border(?:-(?:top|bottom|left|right))?(?:-color)?)\s*:\s*([^;"]+)/g,
      ),
    ].flatMap((match) =>
      (match[1] ?? "")
        .trim()
        .split(/\s+/)
        .slice(-1)
        .filter((value) => value !== "0"),
    );
    expect(declared.length).toBeGreaterThan(0);
    const theme = new Set<string>(Object.values(themeHex));
    expect(declared.filter((value) => !theme.has(value.toLowerCase()))).toEqual([]);
    expect(html).not.toMatch(/(?:rgb|hsl)a?\(/);
  });

  it("escapes what a person typed", async () => {
    const html = await renderIssueHtml(
      {
        ...issue,
        blocks: [{ id: "intro", type: "intro", text: "<script>alert(1)</script>" }],
      },
      site,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("draws a property block through NewsletterBlock: the image, the title, the deck and one link", async () => {
    const html = await renderIssueHtml(issue, site);
    expect(html).toContain(`src="${picture.image_url}"`);
    expect(html).toContain("A quiet house.");
    expect(html.match(/View the property/g)).toHaveLength(1);
    expect(html).not.toContain("utm_source=newsletter");
  });

  it("puts the line a person wrote above a property block", async () => {
    const blocks = [{ ...propertyBlock(3), text: "Newly listed.", slug: "oak-hill", ...picture }];
    const html = await renderIssueHtml({ ...issue, blocks }, site);
    expect(html.indexOf("Newly listed.")).toBeGreaterThan(0);
    expect(html.indexOf("Newly listed.")).toBeLessThan(html.indexOf("Oak Hill"));
  });

  it("refuses a property block whose address cannot be read, without a retry", async () => {
    const blocks = [
      { ...propertyBlock(3), slug: "oak-hill", ...picture, link: "/property/oak-hill" },
    ];
    await expect(renderIssueHtml({ ...issue, blocks }, site)).rejects.toThrow(NonRetryableError);
  });

  it("takes the campaign from the number of its own issue", async () => {
    const other: RenderIssue = {
      ...issue,
      number: 9,
      blocks: [{ ...storyBlock(3, "Later"), slug: uuid(3) }],
    };
    expect(hrefs(await renderIssueHtml(other, site)).join(" ")).toContain("utm_campaign=issue-9");
  });
});

describe("renderPreview", () => {
  it("is the same issue at a desktop and a phone width", async () => {
    const desktop = await renderPreview(issue, "desktop", site);
    const phone = await renderPreview(issue, "phone", site);
    expect(desktop.width).toBeGreaterThan(phone.width);
    expect(phone.width).toBeLessThanOrEqual(430);
    expect(phone.html).toBe(desktop.html);
    expect(phone.html).toContain("Under the oaks");
  });

  it("points the unsubscribe link at nothing, since only Resend fills the variable", async () => {
    const { html } = await renderPreview(issue, "desktop", site);
    expect(html).not.toContain(UNSUBSCRIBE);
    expect(hrefs(html)).toContain("#");
  });
});

describe("loadBlocks, the property block", () => {
  const stored = (blocks: StoredIssue["blocks"]): StoredIssue => ({
    id: uuid(900),
    number: 4,
    status: "approved",
    approval_count: 1,
    blocks,
    subject: null,
    preheader: null,
    resend_broadcast_id: null,
  });

  const world = (meta: unknown) =>
    newsletterDb({
      properties: [
        { id: uuid(3), slug: "oak-hill", editorial_state: "published", taken_down_at: null },
      ],
      assets: [{ id: uuid(103), meta }],
    }).db satisfies Db;

  it("reads the image and the link from meta.block of the asset", async () => {
    const loaded = await loadBlocks(
      world({ block: { title: "T", deck: "D", ...picture } }),
      stored([propertyBlock(3)]),
    );
    expect(loaded.render.blocks).toEqual([{ ...propertyBlock(3), slug: "oak-hill", ...picture }]);
    expect(loaded.unpublished).toEqual([]);
  });

  it.each([
    ["no image", { link: picture.link }],
    ["an image on http", { ...picture, image_url: "http://matterofplace.com/a.jpg" }],
    ["a link that is not https", { ...picture, link: "javascript:alert(1)" }],
  ])("refuses an asset with %s as incomplete", async (_name, block) => {
    await expect(loadBlocks(world({ block }), stored([propertyBlock(3)]))).rejects.toThrow(
      "asset_incomplete",
    );
  });
});
