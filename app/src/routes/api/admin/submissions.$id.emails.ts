import { createFileRoute } from "@tanstack/react-router";
import { submissionEmailsSchema } from "../../../domain/admin-emails";
import { submissionIdInputSchema } from "../../../domain/admin-submissions";
import { submissionEmails } from "../../../server/emails/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W9 item 2: every email about one request and what became of it; the same right as reading the request.
export const Route = createFileRoute("/api/admin/submissions/$id/emails")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.get",
        input: submissionIdInputSchema,
        output: submissionEmailsSchema,
        handler: (ctx, input) => submissionEmails(ctx.actor, ctx.db, input),
      }),
    },
  },
});
