import { createFileRoute } from "@tanstack/react-router";
import { proposedPostDecisionSchema, proposedPostNoteSchema } from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { rejectProposedPost } from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/$id/reject")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.proposed_reject",
        input: proposedPostNoteSchema,
        output: proposedPostDecisionSchema,
        handler: (ctx, input) => rejectProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
