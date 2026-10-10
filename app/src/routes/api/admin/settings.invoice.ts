import { createFileRoute } from "@tanstack/react-router";
import { invoicePutInput } from "../../../domain/admin-settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putInvoice } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/invoice")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.invoice_put",
        input: invoicePutInput,
        output: invoicePutInput,
        handler: (ctx, input) => putInvoice(ctx.actor, ctx.db, input),
      }),
    },
  },
});
