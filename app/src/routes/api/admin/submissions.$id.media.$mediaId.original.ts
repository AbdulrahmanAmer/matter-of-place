import { createFileRoute } from "@tanstack/react-router";
import { originalAnswerSchema, originalInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { originalUrl } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/media/$mediaId/original")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.get",
        input: originalInputSchema,
        output: originalAnswerSchema,
        handler: (ctx, input) => originalUrl(ctx.actor, ctx.db, input),
      }),
    },
  },
});
