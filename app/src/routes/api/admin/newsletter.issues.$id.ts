import { createFileRoute } from "@tanstack/react-router";
import {
  issueIdInputSchema,
  issueSchema,
  issueUpdateInputSchema,
} from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getIssue, updateIssue } from "../../../server/newsletter/service";

const UPDATE_BODY_BYTES = 131_072;

export const Route = createFileRoute("/api/admin/newsletter/issues/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.issues_get",
        input: issueIdInputSchema,
        output: issueSchema,
        handler: (ctx, input) => getIssue(ctx.actor, ctx.db, input),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "newsletter.update",
        input: issueUpdateInputSchema,
        output: issueSchema,
        bodyLimitBytes: UPDATE_BODY_BYTES,
        handler: (ctx, input) => updateIssue(ctx.actor, ctx.db, input),
      }),
    },
  },
});
