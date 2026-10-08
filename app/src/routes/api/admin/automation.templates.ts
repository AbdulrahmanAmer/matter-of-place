import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getTemplates } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/templates")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: z.object({}),
        handler: (ctx) => getTemplates(ctx.actor, ctx.db),
      }),
    },
  },
});
