import { createFileRoute } from "@tanstack/react-router";
import { jobIdSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { retryJob } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/$id/retry")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "jobs.retry",
        input: jobIdSchema,
        handler: (ctx, input) => retryJob(ctx.actor, ctx.db, input),
      }),
    },
  },
});
