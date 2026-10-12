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
          // W2 step 6: why a proposal was declined, or the person's own version of an approved one; each teaches.
          reason: z.string().trim().min(1).max(1000).optional(),
          edited_body: z.string().trim().min(1).max(20000).optional(),
        }),
        output: z.object({ state: z.string() }),
        handler: (ctx, { id, ...input }) => decideApproval(ctx.actor, ctx.db, id, input),
      }),
    },
  },
});
