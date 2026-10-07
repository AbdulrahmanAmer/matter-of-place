import { render } from "@react-email/render";
import { createElement } from "react";
import type { NewsletterBlock } from "../../domain/newsletter.ts";
import { UNSUBSCRIBE_URL } from "../../templates/email/blocks/footer.tsx";
import { PlaceNotes, type IssueBlockView } from "../../templates/email/place-notes.tsx";
import type { SiteContext } from "../email/context.ts";
import { NonRetryableError } from "../jobs/types.ts";

// The one renderer of an issue (B11 invariant 8): the sent broadcast, the preview on screen 13 and the test send all
// come through `renderIssueHtml`, so what an editor sees is what a subscriber gets.

type IntroBlock = Extract<NewsletterBlock, { type: "intro" }>;
type StoryBlock = Extract<NewsletterBlock, { type: "story" }>;
type PropertyBlock = Extract<NewsletterBlock, { type: "property" }>;

/**
 * An issue as the renderer reads it. A story or property block also carries its `slug`, which the stored block does
 * not hold: the caller (the send job, the preview route) reads it from the story or property row. A property block
 * carries `link` as B9 stored it in `meta.block.link`.
 */
export interface RenderIssue {
  number: number;
  subject: string;
  preheader: string;
  blocks: (
    IntroBlock | (StoryBlock & { slug: string }) | (PropertyBlock & { slug: string; link: string })
  )[];
}

const UTM = /^utm_/i;

/**
 * `url` with the Place Notes UTM set: any `utm_*` parameter it holds (B9's `propertyLink(slug, "newsletter")` puts
 * `utm_source=newsletter` there) is replaced, every other parameter is kept. `campaign` is `issue-<n>` for an issue
 * and `standalone-<slug>` for a standalone email.
 */
export function withUtm(url: string, campaign: string, slug: string): string {
  if (!URL.canParse(url)) throw new NonRetryableError("invalid_link");
  const address = new URL(url);
  for (const key of [...address.searchParams.keys()]) {
    if (UTM.test(key)) address.searchParams.delete(key);
  }
  address.searchParams.set("utm_source", "place_notes");
  address.searchParams.set("utm_medium", "email");
  address.searchParams.set("utm_campaign", campaign);
  address.searchParams.set("utm_content", slug);
  return address.toString();
}

function viewOf(
  block: RenderIssue["blocks"][number],
  campaign: string,
  site: SiteContext,
): IssueBlockView {
  switch (block.type) {
    case "intro":
      return { type: "intro", id: block.id, text: block.text };
    case "story":
      return {
        type: "story",
        id: block.id,
        title: block.title,
        deck: block.deck,
        text: block.text,
        href: withUtm(`${site.siteUrl}/stories/${block.slug}`, campaign, block.slug),
      };
    case "property":
      // STUB(B9 steps 7-11): B9's `NewsletterBlock.tsx` draws the property block from `meta.block`; until it is on main an issue holding one cannot render
      throw new NonRetryableError("property_block_unavailable");
  }
}

/** The HTML of an issue, with Resend's unsubscribe variable left in the footer for Resend to fill. */
export async function renderIssueHtml(issue: RenderIssue, site: SiteContext): Promise<string> {
  const campaign = `issue-${String(issue.number)}`;
  return render(
    createElement(PlaceNotes, {
      title: issue.subject,
      preheader: issue.preheader,
      number: issue.number,
      blocks: issue.blocks.map((block) => viewOf(block, campaign, site)),
      site,
    }),
  );
}

const PREVIEW_WIDTH = { desktop: 680, phone: 390 } as const;

/**
 * The issue for the preview frame of screen 13: the same HTML a subscriber gets, the unsubscribe variable replaced by
 * an inert address (nothing fills it outside Resend), and the width in pixels of the frame that shows it.
 */
export async function renderPreview(
  issue: RenderIssue,
  viewport: keyof typeof PREVIEW_WIDTH,
  site: SiteContext,
): Promise<{ html: string; width: number }> {
  const html = await renderIssueHtml(issue, site);
  return { html: html.replaceAll(UNSUBSCRIBE_URL, "#"), width: PREVIEW_WIDTH[viewport] };
}
