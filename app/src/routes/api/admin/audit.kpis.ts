import { createFileRoute } from "@tanstack/react-router";
import { auditKpisQuery } from "../../../domain/admin-audit";
import { getKpis } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// Robot-only (gap audit item 21): no admin screen calls this; the Saturday audit robot reads it with the agent key
// (workspace/audits/tools/kpis.mjs).
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
