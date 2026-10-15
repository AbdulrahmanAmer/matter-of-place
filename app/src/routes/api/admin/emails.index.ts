import { createFileRoute } from "@tanstack/react-router";
import { emailListInputSchema, emailListSchema } from "../../../domain/admin-emails";
import { listEmails } from "../../../server/email/sent";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W9 item 2 and W7 item 1: the Sent emails screen, under System beside the Activity log and with its right.
export const Route = createFileRoute("/api/admin/emails/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.list",
        input: emailListInputSchema,
        output: emailListSchema,
        handler: (ctx, input) => listEmails(ctx.actor, ctx.db, input),
      }),
    },
  },
});
