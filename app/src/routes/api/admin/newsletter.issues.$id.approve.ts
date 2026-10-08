import { createFileRoute } from "@tanstack/react-router";
import { approveInputSchema, issueSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { approveIssue } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/$id/approve")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "newsletter.approve",
        input: approveInputSchema,
        output: issueSchema,
        handler: (ctx, input) => approveIssue(ctx.actor, ctx.db, input),
      }),
    },
  },
});
