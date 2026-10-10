import { createFileRoute } from "@tanstack/react-router";
import { comingSoonPutInput } from "../../../domain/admin-settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putComingSoon } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/coming-soon")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.coming_soon_put",
        input: comingSoonPutInput,
        output: comingSoonPutInput,
        handler: (ctx, input) => putComingSoon(ctx.actor, ctx.db, input),
      }),
    },
  },
});
