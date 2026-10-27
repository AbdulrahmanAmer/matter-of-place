import { z } from "zod";
import { GraphError } from "../../channels/meta.ts";
import { sendReply } from "../../channels/meta-inbox.ts";
import { AppError } from "../../lib/errors.ts";
import { liveSideEffects } from "../../lib/runtime-env.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// W8 item 4: an approved `reply_social` proposal (workforce_decide enqueues this job keyed by the approval, only after
// a person approved it) is sent once through the Meta adapter: under the comment, or into the conversation.
// `social_inbox_reply_begin` marks the row `sending` before any Graph write and answers a rerun with the state
// already reached, so a retry never sends twice; it refuses, in fixed words, a reply no person approved and a message
// past Instagram's 24-hour window. With Instagram switched off in Channels or posting off here
// (`liveSideEffects("social")`) nothing is written and the refusal is recorded; Graph's refusal is recorded as failed,
// and a send that did not come back, or a transient or 5xx answer to the write, as unknown. Each outcome is said in
// Matter's thread by `social_inbox_reply_result`.

/** A light job's lease (reap_stale_jobs): a send begun more recently may still be in flight. */
const LEASE_MS = 5 * 60 * 1000;

const dataSchema = z.object({ approval_id: z.string().uuid() }).passthrough();
const beginSchema = z.union([
  z.object({
    state: z.literal("send"),
    inbox_id: z.string().uuid(),
    kind: z.enum(["comment", "message"]),
    graph_id: z.string().min(1),
    thread_graph_id: z.string().min(1),
    body: z.string(),
  }),
  z.object({ state: z.literal("refuse"), inbox_id: z.string().uuid(), reason: z.string().min(1) }),
  z.object({
    state: z.string(),
    inbox_id: z.string().uuid().optional(),
    since: z.string().optional(),
  }),
]);

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The job system did not answer (${what}).`);

type Outcome =
  | { outcome: "sent"; replyId: string }
  | { outcome: "refused" | "failed" | "unknown"; error: string };

async function recordOutcome(ctx: StepContext, inboxId: string, result: Outcome): Promise<void> {
  const { error } = await ctx.db.rpc("social_inbox_reply_result", {
    p_inbox_id: inboxId,
    p_outcome: result.outcome,
    ...(result.outcome === "sent"
      ? { p_reply_graph_id: result.replyId }
      : { p_error: result.error }),
  });
  if (error !== null) throw unavailable("social_inbox_reply_result");
}

/** Instagram switched on in Channels (channel_settings), as the read job asks it. */
async function instagramOn(ctx: StepContext): Promise<boolean> {
  const channel = await ctx.db
    .from("channel_settings")
    .select("enabled")
    .eq("channel", "instagram");
  if (channel.error !== null) throw unavailable("channel_settings");
  return channel.data[0]?.enabled === true;
}

/**
 * Graph refused for good (nothing was posted) or the reply did not fit; a transient or 5xx answer, or no answer, may
 * have reached Instagram, so it is unknown and never sent again.
 */
function failureOf(error: unknown): Outcome {
  if (error instanceof GraphError && error.detail.class !== "retryable")
    return { outcome: "failed", error: error.detail.message };
  if (error instanceof AppError && error.code === "validation")
    return { outcome: "failed", error: error.message };
  return {
    outcome: "unknown",
    error: error instanceof Error ? error.message : "The send did not come back.",
  };
}

export const sendSocialReply: SystemJobDefinition = {
  type: "send_social_reply",
  sideEffect: "sql_guard",
  maxAttempts: 5,
  async run(ctx, _params, data) {
    const input = dataSchema.safeParse(data);
    if (!input.success) throw new NonRetryableError("The job names no approval.");
    const answer = await ctx.db.rpc("social_inbox_reply_begin", {
      p_approval_id: input.data.approval_id,
    });
    if (answer.error !== null) throw unavailable("social_inbox_reply_begin");
    const begun = beginSchema.parse(answer.data);
    if ("reason" in begun) {
      await recordOutcome(ctx, begun.inbox_id, { outcome: "refused", error: begun.reason });
      return { status: "done", result: { refused: begun.reason } };
    }
    if (!("kind" in begun)) {
      // A rerun of a send that began: inside the lease it may still be in flight, so it is asked again once the lease
      // is over; after it, the outcome is unknown, said once, never sent again.
      if (begun.state === "sending" && begun.inbox_id !== undefined) {
        const leaseEnds = Date.parse(begun.since ?? "") + LEASE_MS;
        if (Number.isFinite(leaseEnds) && ctx.now.getTime() < leaseEnds) {
          return {
            status: "retry_at",
            at: new Date(leaseEnds),
            reason: "The send began under five minutes ago and may still be in flight.",
          };
        }
        await recordOutcome(ctx, begun.inbox_id, {
          outcome: "unknown",
          error: "The send began and did not come back.",
        });
      }
      return { status: "done", result: { skipped: begun.state } };
    }
    if (!(await instagramOn(ctx))) {
      await recordOutcome(ctx, begun.inbox_id, {
        outcome: "refused",
        error: "Instagram is switched off in Channels: no write was made.",
      });
      return { status: "done", result: { refused: "instagram_off" } };
    }
    if (!liveSideEffects("social")) {
      await recordOutcome(ctx, begun.inbox_id, {
        outcome: "refused",
        error: "Posting is switched off here: no write was made.",
      });
      return { status: "done", result: { refused: "not_live" } };
    }
    let result: Outcome;
    try {
      result = { outcome: "sent", replyId: await sendReply(ctx, begun, begun.body) };
    } catch (error) {
      result = failureOf(error);
    }
    await recordOutcome(ctx, begun.inbox_id, result);
    return {
      status: "done",
      result:
        result.outcome === "sent" ? { sent: result.replyId } : { [result.outcome]: result.error },
    };
  },
};
