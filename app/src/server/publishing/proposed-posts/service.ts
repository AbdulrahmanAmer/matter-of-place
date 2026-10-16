import { z } from "zod";
import type { Json } from "../../../db/index.ts";
import { ADMIN_PAGE_MAX } from "../../../domain/admin-page.ts";
import {
  adminProposedPostSchema,
  postFileSchema,
  postRevisionSchema,
  proposedPostDecisionSchema,
  proposedPostDetailSchema,
  type AdminProposedPost,
  type ProposedPostDecision,
  type ProposedPostFilters,
  type ProposedPostInput,
  type ProposedPostRevise,
} from "../../../domain/proposed-posts.ts";
import { fanoutEvent } from "../../automation/fanout.ts";
import { fromRpcError } from "../../lib/admin-errors.ts";
import type { AdminActor } from "../../lib/admin-route.ts";
import { auditContext } from "../../lib/audit.ts";
import { authorize } from "../../lib/authz.ts";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { logLine } from "../../lib/log.ts";
import { mediaUrl } from "../../lib/media-store.ts";

// W8 item 10 (rulings H116, H117): proposed posts. Each function is reached through a `defineAdminRoute` handler,
// authorizes again (SEC-04) and makes each write through exactly one SQL function. Who decides is the matrix's
// (`permissions/proposed-posts.ts`); approval is a person's only, so every agent key is refused it here.

const POST_COLUMNS =
  "id, title, property_id, submission_id, proposer_kind, proposer_agent, proposer_user, test, status, revision, rejection_note, approved_at, created_at, updated_at";
const CHANNEL_COLUMNS =
  "post_id, revision, channel, format, caption, media, asset_id, social_post_id";

/** The only colleague whose key decides here: every agent key is Matter's (H113), and it holds `admin`. */
const MATTER = "matter";

const mediaSchema = z.object({
  images: z.array(postFileSchema).default([]),
  reel: z
    .object({ video: postFileSchema, poster: postFileSchema.nullable().default(null) })
    .nullable()
    .default(null),
});

/** What `approve_proposed_post` answers: the events to plan and the rows the posting path reads. */
const approvedSchema = proposedPostDecisionSchema.omit({ revision: true });

type PostRow = Omit<AdminProposedPost, "channels">;
interface ChannelRow {
  post_id: string;
  revision: number;
  channel: string;
  format: string;
  caption: string;
  media: Json;
  asset_id: string | null;
  social_post_id: string | null;
}

const notFound = () => new AppError("not_found", undefined, "This proposed post does not exist.");

/** PostgREST's 416 for an offset past the last match (G-252); `offset = total` still answers an empty page. */
const PAST_LAST_ROW = "PGRST103";

const withUrl = <T extends { key: string }>(file: T) => ({ ...file, url: mediaUrl(file.key) });

function toAdmin(post: PostRow, channels: readonly ChannelRow[]): AdminProposedPost {
  return adminProposedPostSchema.parse({
    ...post,
    channels: channels
      .filter((row) => row.post_id === post.id && row.revision === post.revision)
      .map((row) => {
        const media = mediaSchema.parse(row.media);
        return {
          channel: row.channel,
          format: row.format,
          caption: row.caption,
          images: media.images.map(withUrl),
          reel:
            media.reel === null
              ? null
              : {
                  video: withUrl(media.reel.video),
                  poster: media.reel.poster === null ? null : withUrl(media.reel.poster),
                },
          asset_id: row.asset_id,
          social_post_id: row.social_post_id,
        };
      }),
  });
}

async function channelsOf(db: Db, ids: readonly string[]): Promise<ChannelRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("proposed_post_channels")
    .select(CHANNEL_COLUMNS)
    .in("post_id", [...ids])
    .order("channel");
  if (error !== null) throw fromRpcError(error);
  return data;
}

function noCount(): never {
  throw new Error("channels.proposed_list answered without a count");
}

function matching(db: Db, filters: ProposedPostFilters, head: boolean) {
  let query = db.from("proposed_posts").select(POST_COLUMNS, { count: "exact", head });
  if (filters.status !== undefined) query = query.eq("status", filters.status);
  return query;
}

/** `GET /api/admin/proposed-posts`: 50 a page, newest first, each with the channels of its current revision. */
export async function listProposedPosts(
  actor: AdminActor,
  db: Db,
  filters: ProposedPostFilters,
): Promise<{ items: AdminProposedPost[]; total: number }> {
  authorize(actor, "channels.proposed_list");
  const first = (filters.page - 1) * ADMIN_PAGE_MAX;
  const { data, error, count } = await matching(db, filters, false)
    .order("created_at", { ascending: false })
    .order("id")
    .range(first, first + ADMIN_PAGE_MAX - 1);
  if (error?.code === PAST_LAST_ROW) {
    const counted = await matching(db, filters, true);
    if (counted.error !== null) throw fromRpcError(counted.error);
    return { items: [], total: counted.count ?? noCount() };
  }
  if (error !== null) throw fromRpcError(error);
  if (count === null) return noCount();
  const channels = await channelsOf(
    db,
    data.map((post) => post.id),
  );
  return { items: data.map((post) => toAdmin(post, channels)), total: count };
}

/** `GET /api/admin/proposed-posts/:id`: the post, its current channels and every revision sent back. */
export async function getProposedPost(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<z.infer<typeof proposedPostDetailSchema>> {
  authorize(actor, "channels.proposed_get");
  const { data, error } = await db.from("proposed_posts").select(POST_COLUMNS).eq("id", input.id);
  if (error !== null) throw fromRpcError(error);
  const post = data[0];
  if (post === undefined) throw notFound();
  const [channels, revisions] = await Promise.all([
    channelsOf(db, [post.id]),
    db
      .from("proposed_post_revisions")
      .select("revision, reason, note, asked_by, asked_by_kind, snapshot, created_at")
      .eq("post_id", post.id)
      .order("revision"),
  ]);
  if (revisions.error !== null) throw fromRpcError(revisions.error);
  return proposedPostDetailSchema.parse({
    ...toAdmin(post, channels),
    revisions: z.array(postRevisionSchema).parse(revisions.data),
  });
}

/** Who proposes: a person under their account, or Matter's key as the colleague `matter` under its own. */
function proposer(actor: AdminActor) {
  return actor.kind === "agent"
    ? { p_proposer_kind: "agent" as const, p_proposer_agent: MATTER }
    : { p_proposer_kind: "human" as const };
}

/** `POST /api/admin/proposed-posts` through `create_proposed_post`; the channel rules ran in the input's parse. */
export async function createProposedPost(
  actor: AdminActor,
  db: Db,
  input: ProposedPostInput,
): Promise<ProposedPostDecision> {
  authorize(actor, "channels.proposed_create");
  const { data, error } = await db.rpc("create_proposed_post", {
    p_title: input.title,
    p_channels: input.channels,
    ...proposer(actor),
    p_actor: actor.userId,
    p_request_id: actor.requestId,
    ...(input.property_id === null ? {} : { p_property: input.property_id }),
    ...(input.submission_id === null ? {} : { p_submission: input.submission_id }),
    p_test: input.test,
  });
  if (error !== null) throw fromRpcError(error);
  return { post_id: data, revision: 1, event_ids: [], social_post_ids: [] };
}

/** `POST /api/admin/proposed-posts/:id/revise` through `revise_proposed_post`: a rejected post's next revision. */
export async function reviseProposedPost(
  actor: AdminActor,
  db: Db,
  input: ProposedPostRevise,
): Promise<ProposedPostDecision> {
  authorize(actor, "channels.proposed_revise");
  const { data, error } = await db.rpc("revise_proposed_post", {
    p_id: input.id,
    p_channels: input.channels,
    ...auditContext(actor),
    ...(input.title === undefined ? {} : { p_title: input.title }),
    ...(actor.kind === "agent" ? { p_proposer_agent: MATTER } : {}),
  });
  if (error !== null) throw fromRpcError(error);
  return { post_id: input.id, revision: data, event_ids: [], social_post_ids: [] };
}

async function planEvent(db: Db, eventId: string): Promise<void> {
  try {
    await fanoutEvent(db, eventId);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "server";
    logLine("warn", "fanout_failed", { eventId, code });
  }
}

/**
 * `POST /api/admin/proposed-posts/:id/approve` through `approve_proposed_post`, for the revision the person saw. Every
 * agent key is refused before any call (H116, the 60 days of human approval); the function refuses one too. Each
 * channel's `asset.approved` event is planned after the commit; a failed plan waits for the job runner's sweep.
 */
export async function approveProposedPost(
  actor: AdminActor,
  db: Db,
  input: { id: string; revision: number },
): Promise<ProposedPostDecision> {
  authorize(actor, "channels.proposed_approve");
  if (actor.kind === "agent") {
    throw new AppError("manual_approval", undefined, "A person approves a post.");
  }
  const { data, error } = await db.rpc("approve_proposed_post", {
    p_id: input.id,
    p_revision: input.revision,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  const decision = { ...approvedSchema.parse(data), revision: input.revision };
  for (const eventId of decision.event_ids) await planEvent(db, eventId);
  return decision;
}

async function sendBack(
  actor: AdminActor,
  db: Db,
  input: { id: string; note: string },
  rerender: boolean,
): Promise<ProposedPostDecision> {
  const { data, error } = await db.rpc("reject_proposed_post", {
    p_id: input.id,
    p_note: input.note,
    p_rerender: rerender,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { post_id: input.id, revision: data, event_ids: [], social_post_ids: [] };
}

/** `POST /api/admin/proposed-posts/:id/reject` through `reject_proposed_post`, with the note. */
export async function rejectProposedPost(
  actor: AdminActor,
  db: Db,
  input: { id: string; note: string },
): Promise<ProposedPostDecision> {
  authorize(actor, "channels.proposed_reject");
  return sendBack(actor, db, input, false);
}

/** `POST /api/admin/proposed-posts/:id/rerender`: sent back with a note asking for the visuals to be made again. */
export async function rerenderProposedPost(
  actor: AdminActor,
  db: Db,
  input: { id: string; note: string },
): Promise<ProposedPostDecision> {
  authorize(actor, "channels.proposed_rerender");
  return sendBack(actor, db, input, true);
}
