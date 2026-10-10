import { createFileRoute } from "@tanstack/react-router";
import { userDisabledSchema, userDisableInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setUserDisabled } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/users/$id/disable")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "team.user_disable",
        input: userDisableInputSchema,
        output: userDisabledSchema,
        handler: (ctx, input) => setUserDisabled(ctx.actor, ctx.db, input),
      }),
    },
  },
});
