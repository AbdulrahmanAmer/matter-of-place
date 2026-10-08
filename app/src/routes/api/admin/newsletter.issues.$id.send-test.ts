import { createFileRoute } from "@tanstack/react-router";
import { issueIdInputSchema, sendTestSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { sendTestToActor } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/$id/send-test")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "newsletter.send_test",
        input: issueIdInputSchema,
        output: sendTestSchema,
        handler: (ctx, input) => sendTestToActor(ctx.actor, ctx.db, input),
      }),
    },
  },
});
