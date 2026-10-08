import { createFileRoute } from "@tanstack/react-router";
import { timelineAnswerSchema } from "../../../domain/admin-submissions";
import { propertyIdInputSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { propertyTimeline } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/timeline")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "properties.timeline",
        input: propertyIdInputSchema,
        output: timelineAnswerSchema,
        handler: (ctx, input) => propertyTimeline(ctx.actor, ctx.db, input.id),
      }),
    },
  },
});
