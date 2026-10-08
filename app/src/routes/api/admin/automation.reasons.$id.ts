import { createFileRoute } from "@tanstack/react-router";
import { putReason, reasonPutInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/reasons/$id")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.reasons_put",
        input: reasonPutInput,
        handler: (ctx, input) => putReason(ctx.actor, ctx.db, input),
      }),
    },
  },
});
