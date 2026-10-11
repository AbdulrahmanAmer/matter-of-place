import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { agentUpdateSchema } from "../../../domain/workforce";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { updateAgent } from "../../../server/workforce/service";

// W1: change a colleague's role, instructions, wake-ups, tools or state (pause, off).
export const Route = createFileRoute("/api/admin/workforce/agents/$slug")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "workforce.update",
        input: agentUpdateSchema.extend({ slug: z.string() }),
        output: z.object({ id: z.string().uuid() }),
        handler: (ctx, { slug, ...input }) => updateAgent(ctx.actor, ctx.db, slug, input),
      }),
    },
  },
});
