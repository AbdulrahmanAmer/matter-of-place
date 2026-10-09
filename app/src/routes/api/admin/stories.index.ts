import { createFileRoute } from "@tanstack/react-router";
import {
  storyCreateInputSchema,
  storyListInputSchema,
  storyListSchema,
  storySavedSchema,
} from "../../../domain/admin-stories";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listStories, saveStory } from "../../../server/stories/service";

export const Route = createFileRoute("/api/admin/stories/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "stories.list",
        input: storyListInputSchema,
        output: storyListSchema,
        handler: (ctx, input) => listStories(ctx.actor, ctx.db, input),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "stories.write",
        input: storyCreateInputSchema,
        output: storySavedSchema,
        handler: (ctx, input) => saveStory(ctx.actor, ctx.db, { id: null, ...input }),
      }),
    },
  },
});
