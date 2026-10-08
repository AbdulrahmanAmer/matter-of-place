import { createFileRoute } from "@tanstack/react-router";
import {
  representativeListInputSchema,
  representativeListSchema,
  representativePutAnswerSchema,
  representativePutInputSchema,
} from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listRepresentatives, putRepresentative } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/representatives")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "properties.representatives",
        input: representativeListInputSchema,
        output: representativeListSchema,
        handler: (ctx, input) => listRepresentatives(ctx.actor, ctx.db, input),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.representative_put",
        input: representativePutInputSchema,
        output: representativePutAnswerSchema,
        handler: (ctx, input) => putRepresentative(ctx.actor, ctx.db, input),
      }),
    },
  },
});
