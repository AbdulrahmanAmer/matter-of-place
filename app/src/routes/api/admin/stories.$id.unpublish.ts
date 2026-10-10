import { createFileRoute } from "@tanstack/react-router";
import { storyIdInputSchema, storySavedSchema } from "../../../domain/admin-stories";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { unpublishStory } from "../../../server/stories/service";

export const Route = createFileRoute("/api/admin/stories/$id/unpublish")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "stories.unpublish",
        input: storyIdInputSchema,
        output: storySavedSchema,
        handler: (ctx, { id }) => unpublishStory(ctx.actor, ctx.db, id),
      }),
    },
  },
});
