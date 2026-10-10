import { createFileRoute } from "@tanstack/react-router";
import { keyCreatedSchema, keyCreateInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { createAgentKey } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/agents/$id/keys")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "team.agent_key_create",
        input: keyCreateInputSchema,
        output: keyCreatedSchema,
        handler: (ctx, input) => createAgentKey(ctx.actor, ctx.db, input, ctx.env.MOP_ENV),
      }),
    },
  },
});
