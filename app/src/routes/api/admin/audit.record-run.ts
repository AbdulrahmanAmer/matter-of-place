import { createFileRoute } from "@tanstack/react-router";
import { auditNoInput } from "../../../domain/admin-audit";
import { recordAuditRun } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// Robot-only (gap audit item 21): no admin screen calls this; the Saturday audit robot records its run here with the
// agent key (workspace/audits/tools/run-all.mjs). G9: the body is never read into the call, so a caller cannot pass
// `cron` or `enabled`.
export const Route = createFileRoute("/api/admin/audit/record-run")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.record_run",
        input: auditNoInput,
        handler: (ctx) => recordAuditRun(ctx.actor, ctx.db),
      }),
    },
  },
});
