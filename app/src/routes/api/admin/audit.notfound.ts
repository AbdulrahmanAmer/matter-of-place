import { createFileRoute } from "@tanstack/react-router";
import { auditNotFoundQuery } from "../../../domain/admin-audit";
import { listNotFound } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// Robot-only (gap audit item 21): no admin screen calls this; the Saturday audit robot reads it with the agent key
// (workspace/audits/tools/notfound.mjs).
export const Route = createFileRoute("/api/admin/audit/notfound")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.notfound",
        input: auditNotFoundQuery,
        handler: (ctx, input) => listNotFound(ctx.actor, ctx.db, input.days),
      }),
    },
  },
});
