import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { builtIssueSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { buildIssue } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/build")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "newsletter.build",
        input: z.object({}),
        output: builtIssueSchema,
        handler: (ctx) => buildIssue(ctx.actor, ctx.db),
      }),
    },
  },
});
