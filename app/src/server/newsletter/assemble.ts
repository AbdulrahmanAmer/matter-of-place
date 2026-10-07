import { z } from "zod";
import {
  issueStatuses,
  newsletterBlocksSchema,
  type NewsletterBlock,
} from "../../domain/newsletter.ts";
import type { Db } from "../lib/db.ts";
import { NonRetryableError } from "../jobs/types.ts";

// What the `queue_digest` step does (B11 Contract, invariants 1 and 7): add one approved block to the open draft, or
// build the draft of the next Place Notes from what was published since the last issue. The subject and preheader
// come from rules, never from a model (S20), and a human's edit of either survives a rebuild.

const SUBJECT_MAX = 60;
const PREHEADER_MAX = 110;

type ContentBlock = Exclude<NewsletterBlock, { type: "intro" }>;

/** A property or story that could join the next issue, with what orders it. */
export interface Candidate {
  block: ContentBlock;
  publishedAt: string;
  campaign: boolean;
}

/** The part of an issue `mergeDraft` reads; a draft not saved yet has `blocks: []` and no subject. */
export interface DraftContent {
  number: number;
  blocks: NewsletterBlock[];
  subject: string | null;
  preheader: string | null;
}

export interface Merged {
  blocks: NewsletterBlock[];
  subject: string;
  preheader: string;
  /** How many of the candidates were not in the draft yet. */
  added: number;
}

export type AssembleResult = { issue_id: null } | { issue_id: string; number: number };

const issueRow = z.object({
  id: z.string(),
  number: z.number().int(),
  status: z.enum(issueStatuses),
  blocks: newsletterBlocksSchema,
  subject: z.string().nullable(),
  preheader: z.string().nullable(),
  sent_at: z.string().nullable(),
});

export type Issue = z.infer<typeof issueRow>;

const blockMeta = z.object({ block: z.object({ title: z.string().min(1), deck: z.string() }) });
const savedIssue = z.object({ id: z.string(), number: z.number().int() });

interface Answer {
  data: unknown;
  error: { code: string } | null;
}

// The table and the two functions are not in the generated types until step 4's migration lands.
interface IssueClient {
  from(table: "newsletter_issues"): { select(columns: string): PromiseLike<Answer> };
  rpc(name: "queue_digest_add" | "newsletter_save_draft", args: object): PromiseLike<Answer>;
}

// STUB(B11 step 4): the typed `db.from("newsletter_issues")` and `db.rpc(...)` replace this cast once the migration's types exist
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `newsletter_issues` and its functions are not in the generated types until step 4's migration lands
const issues = (db: Db): IssueClient => db as unknown as IssueClient;

function rowsOf<T>(result: { data: T[] | null; error: unknown }, table: string): T[] {
  if (result.error !== null || result.data === null)
    throw new Error(`newsletter_read_failed:${table}`);
  return result.data;
}

const entityId = (block: ContentBlock): string =>
  block.type === "property" ? block.property_id : block.story_id;

const firstContent = (blocks: NewsletterBlock[]): ContentBlock | undefined =>
  blocks.find((block): block is ContentBlock => block.type !== "intro");

/** No em dash (copy rule), one space between words. */
const tidy = (text: string): string =>
  text
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

/** At most `max` characters, ending on a whole word. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = /\s/.test(text.charAt(max)) ? head.length : head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, "");
}

/** `Place Notes No. <n>: <first title>`, cut at a word to 60 characters. */
export function buildSubject(blocks: NewsletterBlock[], number: number): string {
  const lead = `Place Notes No. ${String(number)}`;
  const first = firstContent(blocks);
  return cutAtWord(first === undefined ? lead : `${lead}: ${tidy(first.title)}`, SUBJECT_MAX);
}

/** The deck of the first block, cut at a word to 110 characters. */
export function buildPreheader(blocks: NewsletterBlock[]): string {
  const first = firstContent(blocks);
  return first === undefined ? "" : cutAtWord(tidy(first.deck), PREHEADER_MAX);
}

/** Campaign properties, then the other properties, then stories; each group newest first. */
export function orderBlocks(candidates: Candidate[]): ContentBlock[] {
  const rank = ({ block, campaign }: Candidate): number =>
    block.type === "story" ? 2 : campaign ? 0 : 1;
  return [...candidates]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.block.id.localeCompare(b.block.id),
    )
    .map(({ block }) => block);
}

/**
 * The open draft's blocks in their order, then the candidates it does not hold yet. A subject or preheader that is not
 * what the rules give for the draft's own blocks was edited by a human and stays; otherwise both are rebuilt.
 */
export function mergeDraft(draft: DraftContent, candidates: Candidate[]): Merged {
  const held = new Set(
    draft.blocks.flatMap((block) => (block.type === "intro" ? [] : [entityId(block)])),
  );
  const fresh = candidates.filter(({ block }) => !held.has(entityId(block)));
  const blocks = [...draft.blocks, ...orderBlocks(fresh)];
  const edited = (given: string | null, built: string): string | null =>
    given !== null && given !== "" && given !== built ? given : null;
  return {
    blocks,
    subject:
      edited(draft.subject, buildSubject(draft.blocks, draft.number)) ??
      buildSubject(blocks, draft.number),
    preheader: edited(draft.preheader, buildPreheader(draft.blocks)) ?? buildPreheader(blocks),
    added: fresh.length,
  };
}

export async function readIssues(db: Db): Promise<Issue[]> {
  const { data, error } = await issues(db)
    .from("newsletter_issues")
    .select("id, number, status, blocks, subject, preheader, sent_at");
  if (error !== null) throw new Error(`newsletter_read_failed:newsletter_issues:${error.code}`);
  return z.array(issueRow).parse(data);
}

/** The newest `sent_at` among the sent issues, as the database wrote it; null before the first send. */
function lastSentAt(all: Issue[]): string | null {
  const times = all.flatMap(({ sent_at }) => (sent_at === null ? [] : [sent_at]));
  return times.reduce<string | null>(
    (latest, time) => (latest === null || Date.parse(time) > Date.parse(latest) ? time : latest),
    null,
  );
}

async function propertyCandidates(db: Db, since: string | null): Promise<Candidate[]> {
  const approved = db
    .from("assets")
    .select("id, property_id, revision, meta")
    .eq("kind", "newsletter_block")
    .eq("status", "approved");
  const assets = rowsOf(
    await (since === null ? approved : approved.gt("approved_at", since)),
    "assets",
  );
  // Only the highest approved revision of a property stands for it.
  const latest = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    const held = latest.get(asset.property_id);
    if (held === undefined || asset.revision > held.revision) latest.set(asset.property_id, asset);
  }
  if (latest.size === 0) return [];
  const properties = rowsOf(
    await db
      .from("properties")
      .select("id, published_at, campaign_tier")
      .in("id", [...latest.keys()])
      .eq("editorial_state", "published")
      .is("taken_down_at", null),
    "properties",
  );
  return properties.flatMap((property) => {
    const asset = latest.get(property.id);
    if (asset === undefined) return [];
    const parsed = blockMeta.safeParse(asset.meta);
    if (!parsed.success) throw new NonRetryableError("asset_block_missing");
    const { title, deck } = parsed.data.block;
    return [
      {
        block: {
          id: `property:${property.id}`,
          type: "property" as const,
          property_id: property.id,
          asset_id: asset.id,
          title,
          deck,
        },
        publishedAt: property.published_at ?? "",
        campaign: property.campaign_tier === "Campaign",
      },
    ];
  });
}

async function storyCandidates(db: Db, since: string | null): Promise<Candidate[]> {
  const published = db
    .from("stories")
    .select("id, title, deck, published_at")
    .eq("editorial_state", "published")
    .is("archived_at", null);
  const stories = rowsOf(
    await (since === null ? published : published.gt("published_at", since)),
    "stories",
  );
  return stories.map((story) => ({
    block: {
      id: `story:${story.id}`,
      type: "story" as const,
      story_id: story.id,
      title: story.title,
      deck: story.deck,
    },
    publishedAt: story.published_at ?? "",
    campaign: false,
  }));
}

/**
 * Published properties and stories since the last sent issue, minus those already in an issue that is approved,
 * sending or sent. A property is a candidate through its highest approved `newsletter_block` revision.
 */
export async function collectCandidates(db: Db, all: Issue[]): Promise<Candidate[]> {
  const since = lastSentAt(all);
  const taken = new Set(
    all
      .filter(({ status }) => status !== "draft")
      .flatMap(({ blocks }) =>
        blocks.flatMap((block) => (block.type === "intro" ? [] : [entityId(block)])),
      ),
  );
  const [properties, stories] = await Promise.all([
    propertyCandidates(db, since),
    storyCandidates(db, since),
  ]);
  return [...properties, ...stories].filter(({ block }) => !taken.has(entityId(block)));
}

/**
 * Builds or refreshes the one open draft. With nothing to put in an issue it saves nothing and answers `issue_id`
 * null, so an empty issue is never made (invariant 1). `requestId` is the job's id, kept in the system audit row.
 */
export async function assemble(db: Db, requestId: string): Promise<AssembleResult> {
  const all = await readIssues(db);
  const draft = all.find(({ status }) => status === "draft");
  const candidates = await collectCandidates(db, all);
  const merged = mergeDraft(
    draft ?? {
      number: Math.max(0, ...all.map(({ number }) => number)) + 1,
      blocks: [],
      subject: null,
      preheader: null,
    },
    candidates,
  );
  if (merged.blocks.length === 0) return { issue_id: null };
  if (
    draft !== undefined &&
    merged.added === 0 &&
    merged.subject === draft.subject &&
    merged.preheader === (draft.preheader ?? "")
  ) {
    return { issue_id: draft.id, number: draft.number };
  }
  const { data, error } = await issues(db).rpc("newsletter_save_draft", {
    p_blocks: newsletterBlocksSchema.parse(merged.blocks),
    p_subject: merged.subject,
    p_preheader: merged.preheader,
    p_actor: null,
    p_actor_kind: null,
    p_request_id: requestId,
  });
  if (error !== null) throw new Error(`newsletter_save_draft_failed:${error.code}`);
  const saved = savedIssue.parse(data);
  return { issue_id: saved.id, number: saved.number };
}

/** Appends the block of an approved asset to the open draft, which the function makes when there is none. */
export async function addBlock(db: Db, propertyId: string, assetId: string): Promise<void> {
  const { error } = await issues(db).rpc("queue_digest_add", {
    p_property: propertyId,
    p_asset: assetId,
  });
  if (error !== null) throw new Error(`queue_digest_add_failed:${error.code}`);
}
