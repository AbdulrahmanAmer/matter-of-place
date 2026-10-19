import { createFileRoute } from "@tanstack/react-router";
import { proposedPostDecisionSchema, proposedPostNoteSchema } from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { rerenderProposedPost } from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/$id/rerender")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.proposed_rerender",
        input: proposedPostNoteSchema,
        output: proposedPostDecisionSchema,
        handler: (ctx, input) => rerenderProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
