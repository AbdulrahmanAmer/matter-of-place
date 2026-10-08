import { createFileRoute } from "@tanstack/react-router";
import {
  getScheduleSetting,
  putScheduleSettings,
  scheduleKeyInput,
  schedulePutInput,
} from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/schedule-settings/$key")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: scheduleKeyInput,
        handler: (ctx, input) => getScheduleSetting(ctx.actor, ctx.db, input),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.schedules_put",
        input: schedulePutInput,
        handler: (ctx, input) => putScheduleSettings(ctx.actor, ctx.db, input),
      }),
    },
  },
});
