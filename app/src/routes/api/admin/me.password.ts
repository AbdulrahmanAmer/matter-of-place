import { createFileRoute } from "@tanstack/react-router";
import { setPasswordInput } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setOwnPassword } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/me/password")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "dashboard.password",
        input: setPasswordInput,
        handler: (ctx, input) => setOwnPassword(ctx.actor, ctx.db, ctx.request, input),
      }),
    },
  },
});
