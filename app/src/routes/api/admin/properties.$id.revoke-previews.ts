import { createFileRoute } from "@tanstack/react-router";
import { propertyIdInputSchema, versionAnswerSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { revokePreviews } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/revoke-previews")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.revoke_previews",
        input: propertyIdInputSchema,
        output: versionAnswerSchema,
        handler: (ctx, input) => revokePreviews(ctx.actor, ctx.db, input.id),
      }),
    },
  },
});
