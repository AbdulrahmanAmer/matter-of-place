import { createFileRoute } from "@tanstack/react-router";
import { publishAnswerSchema, publishInputSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { publishProperty } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/publish")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.publish",
        input: publishInputSchema,
        output: publishAnswerSchema,
        handler: (ctx, input) => publishProperty(ctx.actor, ctx.db, input),
      }),
    },
  },
});
