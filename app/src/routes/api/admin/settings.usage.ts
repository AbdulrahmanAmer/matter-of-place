import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { usageAnswerSchema } from "../../../domain/admin-usage";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getUsage } from "../../../server/settings/usage/service";

export const Route = createFileRoute("/api/admin/settings/usage")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "settings.get",
        input: z.object({}),
        output: usageAnswerSchema,
        handler: (ctx) => getUsage(ctx.actor, ctx.db),
      }),
    },
  },
});
