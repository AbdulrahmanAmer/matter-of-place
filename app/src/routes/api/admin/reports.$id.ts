import { createFileRoute } from "@tanstack/react-router";
import { reportIdInput, reportSchema } from "../../../domain/reports";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getReport } from "../../../server/reports/service";

export const Route = createFileRoute("/api/admin/reports/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "reports.get",
        input: reportIdInput,
        output: reportSchema,
        handler: (ctx, input) => getReport(ctx.actor, ctx.db, input),
      }),
    },
  },
});
