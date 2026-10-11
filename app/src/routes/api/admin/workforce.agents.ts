import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { hireInputSchema } from "../../../domain/workforce";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { hireAgent } from "../../../server/workforce/service";

// W1: hire a colleague.
export const Route = createFileRoute("/api/admin/workforce/agents")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "workforce.hire",
        input: hireInputSchema,
        output: z.object({ id: z.string().uuid() }),
        handler: (ctx, input) => hireAgent(ctx.actor, ctx.db, input),
      }),
    },
  },
});
