import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { flagsPutSchema } from "../../../domain/flags";
import { getFeatureFlags, putFlags } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/flags")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: z.object({}),
        handler: (ctx) => getFeatureFlags(ctx.actor, ctx.db),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.flags_put",
        input: flagsPutSchema,
        handler: (ctx, input) => putFlags(ctx.actor, ctx.db, input),
      }),
    },
  },
});
