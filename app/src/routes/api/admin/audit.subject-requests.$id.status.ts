import { createFileRoute } from "@tanstack/react-router";
import { subjectStatusAnswer, subjectStatusInput } from "../../../domain/admin-audit";
import { setSubjectRequestStatus } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/subject-requests/$id/status")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.subject_status",
        input: subjectStatusInput,
        output: subjectStatusAnswer,
        handler: (ctx, input) => setSubjectRequestStatus(ctx.actor, ctx.db, input),
      }),
    },
  },
});
