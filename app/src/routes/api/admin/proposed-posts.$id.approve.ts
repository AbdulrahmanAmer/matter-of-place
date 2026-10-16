import { createFileRoute } from "@tanstack/react-router";
import {
  proposedPostApproveSchema,
  proposedPostDecisionSchema,
} from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { approveProposedPost } from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/$id/approve")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.proposed_approve",
        input: proposedPostApproveSchema,
        output: proposedPostDecisionSchema,
        handler: (ctx, input) => approveProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
