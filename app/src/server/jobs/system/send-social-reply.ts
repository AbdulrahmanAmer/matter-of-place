import { z } from "zod";
import { GraphError } from "../../channels/meta.ts";
import { sendReply } from "../../channels/meta-inbox.ts";
import { AppError } from "../../lib/errors.ts";
import { liveSideEffects } from "../../lib/runtime-env.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// W8 item 4: an approved `reply_social` proposal (workforce_decide enqueues this job keyed by the approval) is sent
// once through the Meta adapter: under the comment, or into the conversation. `social_inbox_reply_begin` marks the row
// `sending` before any Graph write and answers a rerun with the state already reached, so a retry never sends twice.
// With posting off here (`liveSideEffects("social")`) nothing is written and the refusal is recorded; Graph's refusal
// is recorded as failed, and a send that did not come back as unknown. Each outcome is said in Matter's thread by
// `social_inbox_reply_result`.

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
  z.object({ state: z.string(), inbox_id: z.string().uuid().optional() }),
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

/** Graph refused (nothing was posted) or the reply did not fit; anything else may have reached Instagram. */
function failureOf(error: unknown): Outcome {
  if (error instanceof GraphError) return { outcome: "failed", error: error.detail.message };
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
    if (!("kind" in begun)) {
      // A rerun of a send that began and never came back: the outcome is unknown, said once, never sent again.
      if (begun.state === "sending" && begun.inbox_id !== undefined) {
        await recordOutcome(ctx, begun.inbox_id, {
          outcome: "unknown",
          error: "The send began and did not come back.",
        });
      }
      return { status: "done", result: { skipped: begun.state } };
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
