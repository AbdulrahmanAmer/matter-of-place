import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { channelHealthListSchema } from "../../../domain/channels";
import { channelHealth } from "../../../server/channels/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/channels/health")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "channels.health",
        input: z.object({}),
        output: channelHealthListSchema,
        handler: (ctx) => channelHealth(ctx.actor, ctx.db, new Date()),
      }),
    },
  },
});
