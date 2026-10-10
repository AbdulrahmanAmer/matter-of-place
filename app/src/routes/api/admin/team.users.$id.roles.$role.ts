import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { roleRevokeInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { revokeRole } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/users/$id/roles/$role")({
  server: {
    handlers: {
      DELETE: defineAdminRoute({
        method: "DELETE",
        action: "team.role_revoke",
        input: roleRevokeInputSchema,
        output: z.object({ revoked: z.literal(true) }),
        handler: (ctx, input) => revokeRole(ctx.actor, ctx.db, input),
      }),
    },
  },
});
