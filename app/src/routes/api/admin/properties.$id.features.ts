import { createFileRoute } from "@tanstack/react-router";
import { featuresInputSchema, versionAnswerSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setFeatures } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/features")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "properties.update",
        input: featuresInputSchema,
        output: versionAnswerSchema,
        handler: (ctx, input) => setFeatures(ctx.actor, ctx.db, input),
      }),
    },
  },
});
