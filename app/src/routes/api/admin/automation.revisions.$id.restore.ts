import { createFileRoute } from "@tanstack/react-router";
import { restoreInput, restoreRevision } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/revisions/$id/restore")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "automation.revisions_restore",
        input: restoreInput,
        handler: (ctx, input) => restoreRevision(ctx.actor, ctx.db, input),
      }),
    },
  },
});
