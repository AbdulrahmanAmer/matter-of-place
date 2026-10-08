import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRecipes } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/recipes")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: z.object({}),
        handler: (ctx) => getRecipes(ctx.actor, ctx.db),
      }),
    },
  },
});
