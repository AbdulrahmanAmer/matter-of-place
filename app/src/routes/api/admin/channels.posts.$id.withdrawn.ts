import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { socialPostIdInput } from "../../../domain/channels";
import { markWithdrawn } from "../../../server/channels/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/channels/posts/$id/withdrawn")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.mark_withdrawn",
        input: socialPostIdInput,
        output: z.object({ withdrawn: z.literal(true) }),
        handler: (ctx, input) => markWithdrawn(ctx.actor, ctx.db, input),
      }),
    },
  },
});
