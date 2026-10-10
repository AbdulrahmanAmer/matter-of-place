import { createFileRoute } from "@tanstack/react-router";
import { subjectActionInput, subjectExportSchema } from "../../../domain/admin-audit";
import { exportSubject } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/subject-requests/$id/export")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.subject_export",
        input: subjectActionInput,
        output: subjectExportSchema,
        handler: (ctx, input) => exportSubject(ctx.actor, ctx.db, input),
      }),
    },
  },
});
