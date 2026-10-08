import { createFileRoute } from "@tanstack/react-router";
import { storyPublishInputSchema, storySavedSchema } from "../../../domain/admin-stories";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { publishStory } from "../../../server/stories/service";

export const Route = createFileRoute("/api/admin/stories/$id/publish")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "stories.publish",
        input: storyPublishInputSchema,
        output: storySavedSchema,
        handler: (ctx, input) => publishStory(ctx.actor, ctx.db, input),
      }),
    },
  },
});
