import { createFileRoute } from "@tanstack/react-router";
import { auditListInputSchema, auditPageSchema } from "../../../domain/admin-audit";
import { listAuditLog } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.list",
        input: auditListInputSchema,
        output: auditPageSchema,
        handler: (ctx, input) => listAuditLog(ctx.actor, ctx.db, input),
      }),
    },
  },
});
