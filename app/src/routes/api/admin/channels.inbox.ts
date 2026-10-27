import { createFileRoute } from "@tanstack/react-router";
import { inboxFilters, inboxListSchema } from "../../../domain/channels";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listInbox } from "../../../server/channels/service";

export const Route = createFileRoute("/api/admin/channels/inbox")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "channels.inbox_list",
        input: inboxFilters,
        output: inboxListSchema,
        handler: (ctx, input) => listInbox(ctx.actor, ctx.db, input),
      }),
    },
  },
});
