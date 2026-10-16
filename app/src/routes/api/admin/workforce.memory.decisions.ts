import { createFileRoute } from "@tanstack/react-router";
import { decisionListSchema, decisionQuerySchema } from "../../../domain/admin-team-memory";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listDecisions } from "../../../server/workforce/service";

// W7 item 4: the daily meeting's decisions, newest first (read only). `?status=` reads one status; each is capped alone.
export const Route = createFileRoute("/api/admin/workforce/memory/decisions")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: decisionQuerySchema,
        output: decisionListSchema,
        handler: (ctx, input) => listDecisions(ctx.actor, ctx.db, input.status),
      }),
    },
  },
});
