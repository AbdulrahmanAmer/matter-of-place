import { createFileRoute } from "@tanstack/react-router";
import { submissionIdInputSchema, timelineAnswerSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { timeline } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/timeline")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.timeline",
        input: submissionIdInputSchema,
        output: timelineAnswerSchema,
        handler: (ctx, input) => timeline(ctx.actor, ctx.db, input),
      }),
    },
  },
});
