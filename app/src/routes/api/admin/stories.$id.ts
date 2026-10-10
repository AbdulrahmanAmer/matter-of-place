import { createFileRoute } from "@tanstack/react-router";
import {
  storyDetailSchema,
  storyIdInputSchema,
  storySavedSchema,
  storyUpdateInputSchema,
} from "../../../domain/admin-stories";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getStory, saveStory } from "../../../server/stories/service";

export const Route = createFileRoute("/api/admin/stories/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "stories.get",
        input: storyIdInputSchema,
        output: storyDetailSchema,
        handler: (ctx, { id }) => getStory(ctx.actor, ctx.db, id),
      }),
      PATCH: defineAdminRoute({
        method: "PATCH",
        action: "stories.write",
        input: storyUpdateInputSchema,
        output: storySavedSchema,
        handler: (ctx, input) => saveStory(ctx.actor, ctx.db, input),
      }),
    },
  },
});
