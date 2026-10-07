import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listPayments, listPaymentsInput } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "payments.list",
        input: listPaymentsInput,
        handler: (ctx, input) => listPayments(ctx.actor, ctx.db, input),
      }),
    },
  },
});
