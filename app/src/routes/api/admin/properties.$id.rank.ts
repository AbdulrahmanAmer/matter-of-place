import { createFileRoute } from "@tanstack/react-router";
import { rankInputSchema, versionAnswerSchema } from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setRanks } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/rank")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "properties.rank",
        input: rankInputSchema,
        output: versionAnswerSchema,
        handler: (ctx, input) => setRanks(ctx.actor, ctx.db, input),
      }),
    },
  },
});
