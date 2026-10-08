import { createFileRoute } from "@tanstack/react-router";
import { jobIdSchema } from "../../../domain/jobs";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getJob } from "../../../server/jobs/service";

export const Route = createFileRoute("/api/admin/jobs/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "jobs.get",
        input: jobIdSchema,
        handler: (ctx, input) => getJob(ctx.actor, ctx.db, input),
      }),
    },
  },
});
