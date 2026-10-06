import { createFileRoute } from "@tanstack/react-router";
import { startReviewAnswerSchema, startReviewInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { startReview } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/start-review")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.start_review",
        input: startReviewInputSchema,
        output: startReviewAnswerSchema,
        handler: (ctx, input) => startReview(ctx.actor, ctx.db, input),
      }),
    },
  },
});
