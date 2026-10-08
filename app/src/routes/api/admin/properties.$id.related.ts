import { createFileRoute } from "@tanstack/react-router";
import { relatedInputSchema, versionAnswerSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setRelated } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/related")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "properties.update",
        input: relatedInputSchema,
        output: versionAnswerSchema,
        handler: (ctx, input) => setRelated(ctx.actor, ctx.db, input),
      }),
    },
  },
});
