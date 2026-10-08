import { createFileRoute } from "@tanstack/react-router";
import {
  propertyDetailSchema,
  propertyIdInputSchema,
  propertyUpdateInputSchema,
  versionAnswerSchema,
} from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getProperty, updateProperty } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "properties.get",
        input: propertyIdInputSchema,
        output: propertyDetailSchema,
        handler: (ctx, input) => getProperty(ctx.actor, ctx.db, input.id),
      }),
      PATCH: defineAdminRoute({
        method: "PATCH",
        action: "properties.update",
        input: propertyUpdateInputSchema,
        output: versionAnswerSchema,
        handler: (ctx, input) => updateProperty(ctx.actor, ctx.db, input),
      }),
    },
  },
});
