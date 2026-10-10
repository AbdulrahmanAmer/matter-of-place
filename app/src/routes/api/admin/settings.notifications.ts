import { createFileRoute } from "@tanstack/react-router";
import { notificationsPutInput } from "../../../domain/admin-settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putNotifications } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/notifications")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.notifications_put",
        input: notificationsPutInput,
        output: notificationsPutInput,
        handler: (ctx, input) => putNotifications(ctx.actor, ctx.db, input),
      }),
    },
  },
});
