import { createFileRoute } from "@tanstack/react-router";
import { socialPostFilters, socialPostListSchema } from "../../../domain/channels";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listPosts } from "../../../server/channels/service";

export const Route = createFileRoute("/api/admin/channels/posts")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "channels.posts_list",
        input: socialPostFilters,
        output: socialPostListSchema,
        handler: (ctx, input) => listPosts(ctx.actor, ctx.db, input),
      }),
    },
  },
});
