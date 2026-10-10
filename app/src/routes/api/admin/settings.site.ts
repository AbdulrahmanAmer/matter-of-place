import { createFileRoute } from "@tanstack/react-router";
import { siteSettingsSchema } from "../../../domain/settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putSite } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/site")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.site_put",
        input: siteSettingsSchema,
        output: siteSettingsSchema,
        handler: (ctx, input) => putSite(ctx.actor, ctx.db, input),
      }),
    },
  },
});
