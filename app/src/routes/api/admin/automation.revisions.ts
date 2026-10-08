import { createFileRoute } from "@tanstack/react-router";
import { listRevisions, revisionsInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/revisions")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: revisionsInput,
        handler: (ctx, input) => listRevisions(ctx.actor, ctx.db, input),
      }),
    },
  },
});
