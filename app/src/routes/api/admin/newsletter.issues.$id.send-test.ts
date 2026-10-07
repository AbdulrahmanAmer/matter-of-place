import { createFileRoute } from "@tanstack/react-router";
import { issueIdInputSchema, sendTestSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { staffEmail } from "../../../server/lib/staff-email";
import { sendTest } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/issues/$id/send-test")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "newsletter.send_test",
        input: issueIdInputSchema,
        output: sendTestSchema,
        handler: async (ctx, { id }) =>
          sendTest(ctx.actor, ctx.db, { id, to: await staffEmail(ctx.db, ctx.actor.userId) }),
      }),
    },
  },
});
