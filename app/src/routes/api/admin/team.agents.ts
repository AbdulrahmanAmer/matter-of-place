import { createFileRoute } from "@tanstack/react-router";
import {
  agentCreateInputSchema,
  agentKeysInputSchema,
  agentKeysPageSchema,
  keyCreatedSchema,
} from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { createAgent, listAgentKeys } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/agents")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "team.users_list",
        input: agentKeysInputSchema,
        output: agentKeysPageSchema,
        handler: (ctx, page) => listAgentKeys(ctx.actor, ctx.db, page),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "team.agent_create",
        input: agentCreateInputSchema,
        output: keyCreatedSchema,
        handler: (ctx, input) => createAgent(ctx.actor, ctx.db, input, ctx.env.MOP_ENV),
      }),
    },
  },
});
