import { createFileRoute } from "@tanstack/react-router";
import { reorderAnswerSchema, reorderInputSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { reorderMedia } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/reorder")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "media.reorder",
        input: reorderInputSchema,
        output: reorderAnswerSchema,
        handler: (ctx, input) => reorderMedia(ctx.actor, ctx.db, input),
      }),
    },
  },
});
