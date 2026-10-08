import { createFileRoute } from "@tanstack/react-router";
import { jobIdSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { cancelJob } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/$id/cancel")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "jobs.cancel",
        input: jobIdSchema,
        handler: (ctx, input) => cancelJob(ctx.actor, ctx.db, input),
      }),
    },
  },
});
