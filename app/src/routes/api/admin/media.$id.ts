import { createFileRoute } from "@tanstack/react-router";
import {
  altInputSchema,
  mediaIdAnswerSchema,
  mediaIdInputSchema,
} from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { deleteMedia, setMediaAlt } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/$id")({
  server: {
    handlers: {
      PATCH: defineAdminRoute({
        method: "PATCH",
        action: "media.alt",
        input: altInputSchema,
        output: mediaIdAnswerSchema,
        handler: (ctx, input) => setMediaAlt(ctx.actor, ctx.db, input),
      }),
      DELETE: defineAdminRoute({
        method: "DELETE",
        action: "media.delete",
        input: mediaIdInputSchema,
        output: mediaIdAnswerSchema,
        handler: (ctx, input) => deleteMedia(ctx.actor, ctx.db, input),
      }),
    },
  },
});
