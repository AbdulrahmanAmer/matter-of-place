import { createFileRoute } from "@tanstack/react-router";
import { publishAnswerSchema, unpublishInputSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { unpublishProperty } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/unpublish")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.unpublish",
        input: unpublishInputSchema,
        output: publishAnswerSchema,
        handler: (ctx, input) => unpublishProperty(ctx.actor, ctx.db, input),
      }),
    },
  },
});
