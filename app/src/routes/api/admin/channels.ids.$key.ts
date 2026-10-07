import { createFileRoute } from "@tanstack/react-router";
import { channelIdsAnswerSchema, channelIdsInputSchema } from "../../../domain/channels";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putChannelIds } from "../../../server/channels/service";

export const Route = createFileRoute("/api/admin/channels/ids/$key")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "channels.ids_put",
        input: channelIdsInputSchema,
        output: channelIdsAnswerSchema,
        handler: (ctx, { key, ...body }) => putChannelIds(ctx.actor, ctx.db, key, body),
      }),
    },
  },
});
