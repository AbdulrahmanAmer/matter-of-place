import { createFileRoute } from "@tanstack/react-router";
import { auditNoInput } from "../../../domain/admin-audit";
import { getUsage } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/usage")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.usage",
        input: auditNoInput,
        handler: (ctx) => getUsage(ctx.actor, ctx.db),
      }),
    },
  },
});
