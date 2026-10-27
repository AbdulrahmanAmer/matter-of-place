import { z } from "zod";
import {
  pendingSchema,
  readComments,
  readMessages,
  type InboxRead,
  type Pending,
} from "../../channels/meta-inbox.ts";
import { getMetaToken } from "../../channels/meta-token.ts";
import { AppError } from "../../lib/errors.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";

// W8 item 4: every 15 minutes (pg_cron, 20261027202720_w8_4_social_inbox.sql) the new comments on our published
// Instagram posts and the new messages of our conversations are read and recorded once by their Graph id through
// `social_inbox_record`, which emits one `social.inbox_received` per new row (the Social colleague's wake). With
// Instagram off, its ids unset or no token, the run says why in its result and one log line, and reads nothing.

/** The posts whose comments are read: our Instagram posts of the last 30 days, newest first, at most 25. */
const POST_DAYS = 30;
const MAX_POSTS = 25;
/** A first read starts a day back; every read reaches an hour behind its cursor, as Graph can list a comment late. */
const FIRST_READ_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 60 * 60 * 1000;

const metaIdsSchema = z
  .object({
    page_id: z.string().min(1),
    ig_user_id: z.string().min(1),
    graph_version: z.string().min(1),
  })
  .passthrough();

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The job system did not answer (${what}).`);

type Off = "instagram_off" | "not_configured" | "no_token";

/** Why nothing can be read, or null when Instagram is on with its ids, the app secret and a token. */
async function whyOff(ctx: StepContext): Promise<Off | null> {
  const channel = await ctx.db
    .from("channel_settings")
    .select("enabled")
    .eq("channel", "instagram");
  if (channel.error !== null) throw unavailable("channel_settings");
  if (channel.data[0]?.enabled !== true) return "instagram_off";
  const settings = await ctx.db.from("settings").select("value").eq("key", "meta");
  if (settings.error !== null) throw unavailable("settings");
  if (!metaIdsSchema.safeParse(settings.data[0]?.value).success) return "not_configured";
  const secret = ctx.env["META_APP_SECRET"];
  if (secret === undefined || secret === "") return "not_configured";
  try {
    await getMetaToken(ctx.db);
  } catch (error) {
    if (error instanceof AppError && error.code === "server") return "no_token";
    throw error;
  }
  return null;
}

type Key = "instagram_comments" | "instagram_messages";
interface Cursor {
  since: Date;
  pending: Pending;
}

async function cursors(ctx: StepContext): Promise<Record<Key, Cursor>> {
  const { data, error } = await ctx.db
    .from("social_inbox_cursors")
    .select("key, read_until, pending");
  if (error !== null) throw unavailable("social_inbox_cursors");
  const cursor = (key: Key): Cursor => {
    const row = data.find((stored) => stored.key === key);
    if (row === undefined) {
      return { since: new Date(ctx.now.getTime() - FIRST_READ_MS), pending: {} };
    }
    // Round 3: the lists a read left part way. A value that is not their shape is said once and read afresh.
    const pending = pendingSchema.safeParse(row.pending);
    if (!pending.success) ctx.log("warn", "social_inbox_pending_unreadable", { key });
    return {
      since: new Date(Date.parse(row.read_until) - OVERLAP_MS),
      pending: pending.success ? pending.data : {},
    };
  };
  return {
    instagram_comments: cursor("instagram_comments"),
    instagram_messages: cursor("instagram_messages"),
  };
}

async function ourPosts(ctx: StepContext): Promise<string[]> {
  const { data, error } = await ctx.db
    .from("social_posts")
    .select("remote_id")
    .eq("channel", "instagram")
    .eq("status", "posted")
    .gt("posted_at", new Date(ctx.now.getTime() - POST_DAYS * 24 * 60 * 60 * 1000).toISOString())
    .order("posted_at", { ascending: false })
    .limit(MAX_POSTS);
  if (error !== null) throw unavailable("social_posts");
  return data.flatMap((row) => (row.remote_id === null ? [] : [row.remote_id]));
}

/** What one read recorded, and whether Graph's rate limit ended it (round 4). */
interface Recorded {
  count: number;
  limited: boolean;
}

async function record(ctx: StepContext, key: Key, read: InboxRead): Promise<Recorded> {
  // Round 4: Graph's rate limit ended the read; what it read and the lists left are recorded like a capped read.
  if (read.limited) ctx.log("warn", "social_inbox_rate_limited", { key });
  // Round 3: a cap cut the read short; the lists left part way are stored with the cursor and resumed next tick.
  else if (read.truncated) {
    ctx.log("warn", "social_inbox_truncated", { key, open: Object.keys(read.pending).length });
  }
  const { data, error } = await ctx.db.rpc("social_inbox_record", {
    p_items: read.items,
    p_cursor_key: key,
    p_pending: read.pending,
    ...(read.newest === null ? {} : { p_read_until: read.newest }),
  });
  if (error !== null) throw unavailable("social_inbox_record");
  return { count: data, limited: read.limited };
}

/** Round 4: one read and its record, its error kept so the other read still runs. */
async function settle(read: () => Promise<Recorded>): Promise<Recorded | { error: unknown }> {
  try {
    return await read();
  } catch (error) {
    return { error };
  }
}

export const readSocialInbox: SystemJobDefinition = {
  type: "read_social_inbox",
  // Reads only; the rows are written once by their Graph id, so a rerun records nothing twice.
  sideEffect: "none",
  maxAttempts: 3,
  async run(ctx) {
    const off = await whyOff(ctx);
    if (off !== null) {
      ctx.log("info", "social_inbox_skipped", { reason: off });
      return { status: "done", result: { skipped: off } };
    }
    const { instagram_comments: posts, instagram_messages: inbox } = await cursors(ctx);
    // Round 4: comments and messages are read apart, so an error in one is thrown only once the other is recorded.
    // Graph's rate limit ends a read where it is; what it read and the lists left are recorded (meta-inbox.ts).
    const comments = await settle(async () =>
      record(
        ctx,
        "instagram_comments",
        await readComments(ctx, await ourPosts(ctx), posts.since, posts.pending),
      ),
    );
    const messages = await settle(async () =>
      record(ctx, "instagram_messages", await readMessages(ctx, inbox.since, inbox.pending)),
    );
    if ("error" in comments) throw comments.error;
    if ("error" in messages) throw messages.error;
    const limited = comments.limited || messages.limited;
    return {
      status: "done",
      result: {
        comments: comments.count,
        messages: messages.count,
        ...(limited ? { rate_limited: true } : {}),
      },
    };
  },
};
