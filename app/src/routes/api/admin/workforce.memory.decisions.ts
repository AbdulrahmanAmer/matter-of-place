import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { decisionListSchema } from "../../../domain/admin-team-memory";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listDecisions } from "../../../server/workforce/service";

// W7 item 4: the daily meeting's decisions, newest first (read only).
export const Route = createFileRoute("/api/admin/workforce/memory/decisions")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: z.object({}),
        output: decisionListSchema,
        handler: (ctx) => listDecisions(ctx.actor, ctx.db),
      }),
    },
  },
});
