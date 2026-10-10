import { createFileRoute } from "@tanstack/react-router";
import { subjectRequestListInput, subjectRequestPageSchema } from "../../../domain/admin-audit";
import { listSubjectRequests } from "../../../server/audit/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/audit/subject-requests")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.subject_requests",
        input: subjectRequestListInput,
        output: subjectRequestPageSchema,
        handler: (ctx, input) => listSubjectRequests(ctx.actor, ctx.db, input),
      }),
    },
  },
});
