import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { keyRevokeInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { revokeAgentKey } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/agents/$id/keys/$keyId")({
  server: {
    handlers: {
      DELETE: defineAdminRoute({
        method: "DELETE",
        action: "team.agent_key_revoke",
        input: keyRevokeInputSchema,
        output: z.object({ revoked: z.literal(true) }),
        handler: (ctx, input) => revokeAgentKey(ctx.actor, ctx.db, input),
      }),
    },
  },
});
