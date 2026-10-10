import { createFileRoute } from "@tanstack/react-router";
import { subjectActionInput, subjectFulfilledSchema } from "../../../domain/admin-audit";
import { optOutSubject } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/subject-requests/$id/opt-out")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.subject_opt_out",
        input: subjectActionInput,
        output: subjectFulfilledSchema,
        handler: (ctx, input) => optOutSubject(ctx.actor, ctx.db, input),
      }),
    },
  },
});
