import { createFileRoute } from "@tanstack/react-router";
import {
  createPropertyAnswerSchema,
  createPropertyInputSchema,
  propertyListInputSchema,
  propertyListSchema,
} from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { createProperty, listProperties } from "../../../server/properties/service";

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
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.create",
        input: createPropertyInputSchema,
        output: createPropertyAnswerSchema,
        handler: (ctx, input) => createProperty(ctx.actor, ctx.db, input),
      }),
    },
  },
});
