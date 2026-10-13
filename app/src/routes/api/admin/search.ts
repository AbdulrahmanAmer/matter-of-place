import { createFileRoute } from "@tanstack/react-router";
import { adminSearchAnswerSchema, adminSearchInputSchema } from "../../../domain/admin-search";
import { searchAdmin } from "../../../server/dashboard/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// The top bar's search (W3, admin pass): every group the actor may list, five hits each.
export const Route = createFileRoute("/api/admin/search")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "dashboard.search",
        input: adminSearchInputSchema,
        output: adminSearchAnswerSchema,
        handler: (ctx, input) => searchAdmin(ctx.actor, ctx.db, input),
      }),
    },
  },
});
