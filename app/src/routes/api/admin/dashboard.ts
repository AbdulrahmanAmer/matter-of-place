import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dashboardSchema } from "../../../domain/admin-dashboard";
import { getDashboard } from "../../../server/dashboard/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/dashboard")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "dashboard.get",
        input: z.object({}),
        output: dashboardSchema,
        handler: (ctx) => getDashboard(ctx.actor, ctx.db),
      }),
    },
  },
});
