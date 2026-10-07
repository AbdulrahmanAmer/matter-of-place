import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { activate, pathId } from "../../../server/payments/service";

export const Route = createFileRoute("/api/admin/submissions/$id/activate")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.activate",
        input: pathId,
        handler: (ctx, input) => activate(ctx.actor, ctx.db, input),
      }),
    },
  },
});
