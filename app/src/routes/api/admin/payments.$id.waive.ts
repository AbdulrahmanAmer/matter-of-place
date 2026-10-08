import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { waive, waiveRequest } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/$id/waive")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "payments.waive",
        input: waiveRequest,
        handler: (ctx, input) => waive(ctx.actor, ctx.db, input),
      }),
    },
  },
});
