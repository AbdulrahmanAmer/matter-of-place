import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { markPaid, markPaidRequest } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/$id/mark-paid")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "payments.mark_paid",
        input: markPaidRequest,
        handler: (ctx, input) => markPaid(ctx.actor, ctx.db, input),
      }),
    },
  },
});
