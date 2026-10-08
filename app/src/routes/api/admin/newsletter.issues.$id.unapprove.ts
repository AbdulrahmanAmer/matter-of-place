import { createFileRoute } from "@tanstack/react-router";
import { issueIdInputSchema, issueSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { unapproveIssue } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/$id/unapprove")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "newsletter.unapprove",
        input: issueIdInputSchema,
        output: issueSchema,
        handler: (ctx, input) => unapproveIssue(ctx.actor, ctx.db, input),
      }),
    },
  },
});
