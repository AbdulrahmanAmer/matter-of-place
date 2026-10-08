import { createFileRoute } from "@tanstack/react-router";
import { decisionAnswerSchema, submissionIdInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { accept } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/accept")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.accept",
        input: submissionIdInputSchema,
        output: decisionAnswerSchema,
        handler: (ctx, input) => accept(ctx.actor, ctx.db, input),
      }),
    },
  },
});
