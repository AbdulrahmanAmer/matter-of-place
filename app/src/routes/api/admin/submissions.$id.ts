import { createFileRoute } from "@tanstack/react-router";
import { submissionDetailSchema, submissionIdInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getSubmission } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.get",
        input: submissionIdInputSchema,
        output: submissionDetailSchema,
        handler: (ctx, input) => getSubmission(ctx.actor, ctx.db, input),
      }),
    },
  },
});
