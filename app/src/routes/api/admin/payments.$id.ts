import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getPayment, pathId } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "payments.get",
        input: pathId,
        handler: (ctx, input) => getPayment(ctx.actor, ctx.db, input),
      }),
    },
  },
});
