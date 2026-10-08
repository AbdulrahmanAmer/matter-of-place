import { createFileRoute } from "@tanstack/react-router";
import { jobRetryBulkSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { retryBulkJobs } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/retry-bulk")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "jobs.retry_bulk",
        input: jobRetryBulkSchema,
        handler: (ctx, input) => retryBulkJobs(ctx.actor, ctx.db, input),
      }),
    },
  },
});
