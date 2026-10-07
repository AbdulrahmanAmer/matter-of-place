import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { waiveWithoutInvoice, waiveWithoutInvoiceRequest } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/submissions/$id/waive")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "payments.waive",
        input: waiveWithoutInvoiceRequest,
        handler: (ctx, input) => waiveWithoutInvoice(ctx.actor, ctx.db, input),
      }),
    },
  },
});
