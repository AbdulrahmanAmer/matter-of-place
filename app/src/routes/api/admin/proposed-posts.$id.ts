import { createFileRoute } from "@tanstack/react-router";
import { proposedPostDetailSchema, proposedPostIdSchema } from "../../../domain/proposed-posts";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getProposedPost } from "../../../server/publishing/proposed-posts/service";

export const Route = createFileRoute("/api/admin/proposed-posts/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "channels.proposed_get",
        input: proposedPostIdSchema,
        output: proposedPostDetailSchema,
        handler: (ctx, input) => getProposedPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
