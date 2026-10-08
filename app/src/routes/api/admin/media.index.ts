import { createFileRoute } from "@tanstack/react-router";
import { mediaListSchema, propertyMediaInputSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listMedia } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "media.list",
        input: propertyMediaInputSchema,
        output: mediaListSchema,
        handler: (ctx, input) => listMedia(ctx.actor, ctx.db, input),
      }),
    },
  },
});
