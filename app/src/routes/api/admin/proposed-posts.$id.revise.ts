import { createFileRoute } from "@tanstack/react-router";
import {
  proposedPostDecisionSchema,
  proposedPostReviseSchema,
} from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { reviseProposedPost } from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/$id/revise")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.proposed_revise",
        input: proposedPostReviseSchema,
        output: proposedPostDecisionSchema,
        handler: (ctx, input) => reviseProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
