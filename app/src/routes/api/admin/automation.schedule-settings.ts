import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getScheduleSettings } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/schedule-settings")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: z.object({}),
        handler: (ctx) => getScheduleSettings(ctx.actor, ctx.db),
      }),
    },
  },
});
