import { createFileRoute } from "@tanstack/react-router";
import { attachAnswerSchema, attachInputSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { attachMedia } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/attach")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "media.attach",
        input: attachInputSchema,
        output: attachAnswerSchema,
        handler: (ctx, input) => attachMedia(ctx.actor, ctx.db, input),
      }),
    },
  },
});
