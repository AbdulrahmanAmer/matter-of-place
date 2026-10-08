import { createFileRoute } from "@tanstack/react-router";
import { jobListSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listJobs } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "jobs.list",
        input: jobListSchema,
        handler: (ctx, input) => listJobs(ctx.actor, ctx.db, input),
      }),
    },
  },
});
