import { createFileRoute } from "@tanstack/react-router";
import {
  listSubmissionsInputSchema,
  submissionListSchema,
} from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listSubmissions } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.list",
        input: listSubmissionsInputSchema,
        output: submissionListSchema,
        handler: (ctx, input) => listSubmissions(ctx.actor, ctx.db, input),
      }),
    },
  },
});
