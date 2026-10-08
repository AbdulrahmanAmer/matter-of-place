import { createFileRoute } from "@tanstack/react-router";
import { replaceAnswerSchema, replaceInputSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { replaceMedia } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/$id/replace")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "media.replace",
        input: replaceInputSchema,
        output: replaceAnswerSchema,
        handler: (ctx, input) => replaceMedia(ctx.actor, ctx.db, input),
      }),
    },
  },
});
