import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { subscriberCountsSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listSubscribers } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/subscribers")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.subscribers_count",
        input: z.object({}),
        output: subscriberCountsSchema,
        handler: (ctx) => listSubscribers(ctx.actor, ctx.db),
      }),
    },
  },
});
