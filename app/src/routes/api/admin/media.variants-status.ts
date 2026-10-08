import { createFileRoute } from "@tanstack/react-router";
import { propertyMediaInputSchema, variantsStatusSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { variantsStatus } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/variants-status")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "media.variants_status",
        input: propertyMediaInputSchema,
        output: variantsStatusSchema,
        handler: (ctx, input) => variantsStatus(ctx.actor, ctx.db, input.property_id),
      }),
    },
  },
});
