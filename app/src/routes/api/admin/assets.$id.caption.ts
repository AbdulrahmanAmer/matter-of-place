import { createFileRoute } from "@tanstack/react-router";
import { assetCaptionAnswerSchema, assetCaptionInputSchema } from "../../../domain/admin-assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { editCaption } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/$id/caption")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "assets.caption",
        input: assetCaptionInputSchema,
        output: assetCaptionAnswerSchema,
        handler: (ctx, input) => editCaption(ctx.actor, ctx.db, input),
      }),
    },
  },
});
