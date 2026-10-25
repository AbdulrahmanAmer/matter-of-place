import { createFileRoute } from "@tanstack/react-router";
import {
  inboundMailListInputSchema,
  inboundMailListSchema,
} from "../../../domain/admin-inbound-mail";
import { listInboundMail } from "../../../server/email/inbound/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W8 0h: the Inbound mail part of the Sent emails screen, with the screen's own right.
export const Route = createFileRoute("/api/admin/emails/inbound/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "audit.list",
        input: inboundMailListInputSchema,
        output: inboundMailListSchema,
        handler: (ctx, input) => listInboundMail(ctx.actor, ctx.db, input),
      }),
    },
  },
});
