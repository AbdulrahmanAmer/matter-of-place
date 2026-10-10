import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dailyLimitsSchema } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getDailyLimits, putDailyLimits } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/limits")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "team.users_list",
        input: z.object({}),
        output: dailyLimitsSchema,
        handler: (ctx) => getDailyLimits(ctx.actor, ctx.db),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "team.limits_put",
        input: dailyLimitsSchema,
        output: dailyLimitsSchema,
        handler: (ctx, input) => putDailyLimits(ctx.actor, ctx.db, input),
      }),
    },
  },
});
