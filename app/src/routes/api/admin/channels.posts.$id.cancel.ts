import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { socialPostIdInput } from "../../../domain/channels";
import { cancelPost } from "../../../server/channels/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/channels/posts/$id/cancel")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.cancel",
        input: socialPostIdInput,
        output: z.object({ cancelled: z.literal(true) }),
        handler: (ctx, input) => cancelPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
