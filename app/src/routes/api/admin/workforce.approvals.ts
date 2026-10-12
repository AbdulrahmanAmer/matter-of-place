import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { approvalSchema } from "../../../domain/workforce";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listApprovals } from "../../../server/workforce/service";

// W1: what the team proposes to send or post, waiting for a person.
export const Route = createFileRoute("/api/admin/workforce/approvals")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.approvals",
        input: z.object({}),
        output: z.object({ items: z.array(approvalSchema) }),
        handler: (ctx) => listApprovals(ctx.actor, ctx.db),
      }),
    },
  },
});
