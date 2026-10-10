import { createFileRoute } from "@tanstack/react-router";
import { auditKpisQuery } from "../../../domain/admin-audit";
import { getKpis } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/kpis")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.kpis",
        input: auditKpisQuery,
        handler: (ctx, input) => getKpis(ctx.actor, ctx.db, input.week_start),
      }),
    },
  },
});
