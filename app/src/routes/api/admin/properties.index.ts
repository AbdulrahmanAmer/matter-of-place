import { createFileRoute } from "@tanstack/react-router";
import { propertyListInputSchema, propertyListSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listProperties } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "properties.list",
        input: propertyListInputSchema,
        output: propertyListSchema,
        handler: (ctx, input) => listProperties(ctx.actor, ctx.db, input),
      }),
    },
  },
});
