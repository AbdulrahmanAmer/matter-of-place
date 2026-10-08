import { createFileRoute } from "@tanstack/react-router";
import { reportIdInput } from "../../../domain/admin-reports";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { emailReport } from "../../../server/reports/service";

export const Route = createFileRoute("/api/admin/reports/$id/email")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "reports.email",
        input: reportIdInput,
        handler: (ctx, input) => emailReport(ctx.actor, ctx.db, input),
      }),
    },
  },
});
