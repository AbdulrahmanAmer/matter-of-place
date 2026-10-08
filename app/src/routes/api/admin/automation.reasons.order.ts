import { createFileRoute } from "@tanstack/react-router";
import { reasonOrderInput, reorderReasons } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/reasons/order")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.reasons_put",
        input: reasonOrderInput,
        handler: (ctx, input) => reorderReasons(ctx.actor, ctx.db, input),
      }),
    },
  },
});
