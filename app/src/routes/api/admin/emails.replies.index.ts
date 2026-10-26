import { createFileRoute } from "@tanstack/react-router";
import { replyListInputSchema, replyListSchema } from "../../../domain/admin-emails";
import { listReplies } from "../../../server/email/replies/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W7 item 2: the Replies part of the Sent emails screen, with the screen's own right.
export const Route = createFileRoute("/api/admin/emails/replies/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.list",
        input: replyListInputSchema,
        output: replyListSchema,
        handler: (ctx, input) => listReplies(ctx.actor, ctx.db, input),
      }),
    },
  },
});
