import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { socialPostRetryInput } from "../../../domain/channels";
import { retryPost } from "../../../server/channels/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/channels/posts/$id/retry")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "channels.retry",
        input: socialPostRetryInput,
        output: z.object({ job_id: z.string() }),
        handler: (ctx, input) => retryPost(ctx.actor, ctx.db, input),
      }),
    },
  },
});
