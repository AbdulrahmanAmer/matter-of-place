import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { roleGrantInputSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { grantRole } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/users/$id/roles")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "team.role_grant",
        input: roleGrantInputSchema,
        output: z.object({ id: z.string() }),
        handler: (ctx, input) => grantRole(ctx.actor, ctx.db, input),
      }),
    },
  },
});
