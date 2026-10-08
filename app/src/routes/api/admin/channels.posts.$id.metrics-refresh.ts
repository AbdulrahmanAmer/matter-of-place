import { createFileRoute } from "@tanstack/react-router";
import { socialPostIdInput } from "../../../domain/channels";
import { refreshMetrics } from "../../../server/channels/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/channels/posts/$id/metrics-refresh")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.metrics_refresh",
        input: socialPostIdInput,
        handler: (ctx, input) => refreshMetrics(ctx.actor, ctx.db, input),
      }),
    },
  },
});
