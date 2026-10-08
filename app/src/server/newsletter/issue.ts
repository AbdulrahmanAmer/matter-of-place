import { z } from "zod";
import { issueStatuses, newsletterBlocksSchema } from "../../domain/newsletter.ts";
import { UNSUBSCRIBE_URL } from "../../templates/email/blocks/footer.tsx";
import { footerLines } from "../../templates/email/layout.tsx";
import type { SiteContext } from "../email/context.ts";
import type { RenderedEmail } from "../email/render.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { buildSubject } from "./assemble.ts";
import { renderIssueHtml, withUtm, type RenderIssue } from "./render.ts";

// One issue as the send job, the preview job and screen 13's preview read it: the row, what each block links to, and
// which blocks are no longer public (R31: an outside effect re-checks its preconditions when it runs).

const issueRow = z.object({
  id: z.string(),
  number: z.number().int(),
  status: z.enum(issueStatuses),
  approval_count: z.number().int(),
  blocks: newsletterBlocksSchema,
  subject: z.string().nullable(),
  preheader: z.string().nullable(),
  resend_broadcast_id: z.string().nullable(),
});

export type StoredIssue = z.infer<typeof issueRow>;

type Block = StoredIssue["blocks"][number];
type ContentBlock = Exclude<Block, { type: "intro" }>;

// A mail client must never be given a `javascript:` or plain `http:` address, whoever wrote the stored block.
const https = z.string().url().startsWith("https://");

const assetBlock = z.object({
  block: z.object({ image_key: z.string().min(1), image_url: https, link: https }),
});

function rowsOf<T>(result: { data: T[] | null; error: unknown }, table: string): T[] {
  if (result.error !== null || result.data === null) {
    throw new Error(`newsletter_read_failed:${table}`);
  }
  return result.data;
}

/** The issue, or null when there is none with that id. */
export async function readIssue(db: Db, id: string): Promise<StoredIssue | null> {
  const [row] = rowsOf(
    await db
      .from("newsletter_issues")
      .select("id, number, status, approval_count, blocks, subject, preheader, resend_broadcast_id")
      .eq("id", id)
      .limit(1),
    "newsletter_issues",
  );
  if (row === undefined) return null;
  const parsed = issueRow.safeParse(row);
  if (!parsed.success) throw new NonRetryableError("issue_invalid");
  return parsed.data;
}

export interface LoadedIssue {
  render: RenderIssue;
  /** Property blocks whose property is unpublished or taken down, story blocks whose story is no longer published. */
  unpublished: ContentBlock[];
}

/** Reads the slug (and a property's link) of every block and finds the ones that are no longer public. */
export async function loadBlocks(db: Db, issue: StoredIssue): Promise<LoadedIssue> {
  const ids = (type: ContentBlock["type"]) =>
    issue.blocks.flatMap((block) =>
      block.type !== type ? [] : [block.type === "property" ? block.property_id : block.story_id],
    );
  const assetIds = issue.blocks.flatMap((block) =>
    block.type === "property" ? [block.asset_id] : [],
  );
  const [properties, stories, assets] = await Promise.all([
    db
      .from("properties")
      .select("id, slug, editorial_state, taken_down_at")
      .in("id", ids("property")),
    db.from("stories").select("id, slug, editorial_state, archived_at").in("id", ids("story")),
    db.from("assets").select("id, meta").in("id", assetIds),
  ]);
  const propertyRows = new Map(rowsOf(properties, "properties").map((row) => [row.id, row]));
  const storyRows = new Map(rowsOf(stories, "stories").map((row) => [row.id, row]));
  const pictures = new Map(
    rowsOf(assets, "assets").map((row) => [row.id, assetBlock.safeParse(row.meta).data?.block]),
  );
  const unpublished: ContentBlock[] = [];
  const blocks: RenderIssue["blocks"] = [];
  for (const block of issue.blocks) {
    if (block.type === "intro") {
      blocks.push(block);
    } else if (block.type === "story") {
      const story = storyRows.get(block.story_id);
      if (story?.editorial_state !== "published" || story.archived_at !== null) {
        unpublished.push(block);
      } else blocks.push({ ...block, slug: story.slug });
    } else {
      const property = propertyRows.get(block.property_id);
      const picture = pictures.get(block.asset_id);
      if (property?.editorial_state !== "published" || property.taken_down_at !== null) {
        unpublished.push(block);
      } else if (picture === undefined) {
        throw new NonRetryableError("asset_incomplete");
      } else blocks.push({ ...block, slug: property.slug, ...picture });
    }
  }
  return {
    render: {
      number: issue.number,
      subject: issue.subject ?? buildSubject(issue.blocks, issue.number),
      preheader: issue.preheader ?? "",
      blocks,
    },
    unpublished,
  };
}

/** The plain-text part: each block's words and its link, then the footer lines and the unsubscribe address. */
function issueText(issue: RenderIssue, site: SiteContext): string {
  const campaign = `issue-${String(issue.number)}`;
  const parts = issue.blocks.map((block) => {
    if (block.type === "intro") return block.text;
    const url =
      block.type === "story"
        ? withUtm(`${site.siteUrl}/stories/${block.slug}`, campaign, block.slug)
        : withUtm(block.link, campaign, block.slug);
    return [block.title, block.deck, block.text, url].filter((line) => line).join("\n");
  });
  return `${[...parts, ...footerLines(site), `Unsubscribe: ${UNSUBSCRIBE_URL}`].join("\n\n")}\n`;
}

/** The issue as one email: the subject and preheader of the row, the HTML of `renderIssueHtml` and its text part. */
export async function renderIssue(issue: RenderIssue, site: SiteContext): Promise<RenderedEmail> {
  return {
    subject: issue.subject,
    preheader: issue.preheader,
    html: await renderIssueHtml(issue, site),
    text: issueText(issue, site),
  };
}
