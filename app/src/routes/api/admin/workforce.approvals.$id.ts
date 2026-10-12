import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { decideApproval } from "../../../server/workforce/service";

// W1: a person approves or declines one proposal, for the exact content they read (content_hash).
export const Route = createFileRoute("/api/admin/workforce/approvals/$id")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "workforce.decide",
        input: z.object({
          id: z.string().uuid(),
          decision: z.enum(["approved", "rejected"]),
          content_hash: z.string().regex(/^[0-9a-f]{64}$/),
        }),
        output: z.object({ state: z.string() }),
        handler: (ctx, { id, ...input }) => decideApproval(ctx.actor, ctx.db, id, input),
      }),
    },
  },
});
