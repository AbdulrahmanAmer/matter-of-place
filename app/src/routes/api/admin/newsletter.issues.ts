import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { issueListSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listIssues } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.issues_list",
        input: z.object({}),
        output: issueListSchema,
        handler: (ctx) => listIssues(ctx.actor, ctx.db),
      }),
    },
  },
});
