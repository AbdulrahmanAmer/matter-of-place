import { createFileRoute } from "@tanstack/react-router";
import { reportFilters, reportListSchema } from "../../../domain/reports";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listReports } from "../../../server/reports/service";

export const Route = createFileRoute("/api/admin/reports")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "reports.list",
        input: reportFilters,
        output: reportListSchema,
        handler: (ctx, input) => listReports(ctx.actor, ctx.db, input),
      }),
    },
  },
});
