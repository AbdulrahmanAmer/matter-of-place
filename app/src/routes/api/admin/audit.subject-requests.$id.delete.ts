import { createFileRoute } from "@tanstack/react-router";
import { subjectDeleteInput, subjectFulfilledSchema } from "../../../domain/admin-audit";
import { deleteSubject } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/subject-requests/$id/delete")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.subject_delete",
        input: subjectDeleteInput,
        output: subjectFulfilledSchema,
        handler: (ctx, input) => deleteSubject(ctx.actor, ctx.db, input),
      }),
    },
  },
});
