import { createFileRoute } from "@tanstack/react-router";
import { jobIdSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { approveJob } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/$id/approve")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "jobs.approve",
        input: jobIdSchema,
        handler: (ctx, input) => approveJob(ctx.actor, ctx.db, input),
      }),
    },
  },
});
