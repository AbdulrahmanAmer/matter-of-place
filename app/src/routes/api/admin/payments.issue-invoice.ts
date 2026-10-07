import { createFileRoute } from "@tanstack/react-router";
import { issueInvoiceInput } from "../../../domain/payments";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { issueInvoice } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/payments/issue-invoice")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "payments.issue",
        input: issueInvoiceInput,
        handler: (ctx, input) => issueInvoice(ctx.actor, ctx.db, input),
      }),
    },
  },
});
