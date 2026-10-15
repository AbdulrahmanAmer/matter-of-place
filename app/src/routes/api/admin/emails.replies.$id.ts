import { createFileRoute } from "@tanstack/react-router";
import { replyMarkAnswerSchema, replyMarkInputSchema } from "../../../domain/admin-emails";
import { markReply } from "../../../server/email/replies";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W7 item 2: a reply is marked seen, answered or ignored; the change is audited.
export const Route = createFileRoute("/api/admin/emails/replies/$id")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "audit.reply_mark",
        input: replyMarkInputSchema,
        output: replyMarkAnswerSchema,
        handler: (ctx, input) => markReply(ctx.actor, ctx.db, input),
      }),
    },
  },
});
