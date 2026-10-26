import { createFileRoute } from "@tanstack/react-router";
import {
  proposedPostDecisionSchema,
  proposedPostFilters,
  proposedPostInputSchema,
  proposedPostListSchema,
} from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import {
  createProposedPost,
  listProposedPosts,
} from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "channels.proposed_list",
        input: proposedPostFilters,
        output: proposedPostListSchema,
        handler: (ctx, input) => listProposedPosts(ctx.actor, ctx.db, input),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.proposed_create",
        input: proposedPostInputSchema,
        output: proposedPostDecisionSchema,
        handler: (ctx, input) => createProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
