import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { voidInvoice, voidRequest } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/$id/void")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "payments.void",
        input: voidRequest,
        handler: (ctx, input) => voidInvoice(ctx.actor, ctx.db, input),
      }),
    },
  },
});
