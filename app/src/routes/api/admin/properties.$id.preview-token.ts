import { createFileRoute } from "@tanstack/react-router";
import { previewTokenAnswerSchema, propertyIdInputSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { issuePreviewToken } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/preview-token")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.preview_token",
        input: propertyIdInputSchema,
        output: previewTokenAnswerSchema,
        handler: (ctx, input) =>
          issuePreviewToken(ctx.actor, ctx.db, input.id, ctx.env.PREVIEW_TOKEN_SECRET),
      }),
    },
  },
});
