import { createFileRoute } from "@tanstack/react-router";
import { channelPutInput, putChannelSettings } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/channel-settings/$channel")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.channels_put",
        input: channelPutInput,
        handler: (ctx, input) => putChannelSettings(ctx.actor, ctx.db, input),
      }),
    },
  },
});
