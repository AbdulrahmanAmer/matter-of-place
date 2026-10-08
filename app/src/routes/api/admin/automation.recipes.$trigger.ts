import { createFileRoute } from "@tanstack/react-router";
import { putRecipe, recipePutInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/recipes/$trigger")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.recipes_put",
        input: recipePutInput,
        handler: (ctx, input) => putRecipe(ctx.actor, ctx.db, input),
      }),
    },
  },
});
