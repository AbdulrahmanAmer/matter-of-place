import { createFileRoute } from "@tanstack/react-router";
import { decisionAnswerSchema, declineInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { decline } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/decline")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.decline",
        input: declineInputSchema,
        output: decisionAnswerSchema,
        handler: (ctx, input) => decline(ctx.actor, ctx.db, input),
      }),
    },
  },
});
