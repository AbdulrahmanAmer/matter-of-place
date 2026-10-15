import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listEvents } from "../../../server/jobs/events";

export const Route = createFileRoute("/api/admin/jobs/events")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "jobs.list",
        input: z.object({}),
        handler: (ctx) => listEvents(ctx.actor, ctx.db),
      }),
    },
  },
});
