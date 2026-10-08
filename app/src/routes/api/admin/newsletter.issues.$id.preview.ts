import { createFileRoute } from "@tanstack/react-router";
import { previewInputSchema, previewSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { previewIssue } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/$id/preview")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.preview",
        input: previewInputSchema,
        output: previewSchema,
        handler: (ctx, input) => previewIssue(ctx.actor, ctx.db, input),
      }),
    },
  },
});
