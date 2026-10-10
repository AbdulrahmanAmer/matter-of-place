import { createFileRoute } from "@tanstack/react-router";
import { auditNoInput } from "../../../domain/admin-audit";
import { getHealth } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/health")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.health",
        input: auditNoInput,
        handler: (ctx) => getHealth(ctx.actor, ctx.db),
      }),
    },
  },
});
