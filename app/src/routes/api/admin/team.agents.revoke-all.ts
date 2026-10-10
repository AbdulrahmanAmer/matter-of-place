import { createFileRoute } from "@tanstack/react-router";
import { revokeAllAnswerSchema, revokeAllInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { revokeAllAgentKeys } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/agents/revoke-all")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "team.revoke_all_keys",
        input: revokeAllInputSchema,
        output: revokeAllAnswerSchema,
        handler: (ctx) => revokeAllAgentKeys(ctx.actor, ctx.db),
      }),
    },
  },
});
