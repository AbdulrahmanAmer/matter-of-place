import { describe, expect, it } from "vitest";
import type { SiteContext } from "../../../src/server/email/context";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  renderIssueHtml,
  renderPreview,
  type RenderIssue,
} from "../../../src/server/newsletter/render";
import { themeHex } from "../../../src/templates/theme.gen";
import { propertyBlock, storyBlock, uuid } from "../../fixtures/newsletter-world";

// The issue the editor previews and the subscriber reads (B11 step 5): one renderer, links finished, footer complete.

const UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Stub Entity LLC",
  address: "1 Stub Street, New York, NY",
  contact: { email: null },
};

const issue: RenderIssue = {
  number: 4,
  subject: "Place Notes No. 4: Under the oaks",
  preheader: "A quiet street.",
  blocks: [
    { id: "intro", type: "intro", text: "First line.\nSecond line." },
    { ...storyBlock(1, "Under the oaks", "A quiet street."), slug: "under-the-oaks" },
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
    const colours = (html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => hex.toLowerCase());
    expect(colours.length).toBeGreaterThan(0);
    const theme = new Set<string>(Object.values(themeHex));
    expect(colours.filter((hex) => !theme.has(hex))).toEqual([]);
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

  it("refuses a property block until B9's NewsletterBlock is on main", async () => {
    const blocks = [{ ...propertyBlock(1), slug: "oak-hill", link: "https://matterofplace.com/" }];
    await expect(renderIssueHtml({ ...issue, blocks }, site)).rejects.toThrow(NonRetryableError);
    await expect(renderIssueHtml({ ...issue, blocks }, site)).rejects.toThrow(
      "property_block_unavailable",
    );
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
