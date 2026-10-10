import { createFileRoute } from "@tanstack/react-router";
import { sendTemplateTest, templateKeyInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/templates/$key/send-test")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "automation.templates_send_test",
        input: templateKeyInput,
        handler: (ctx, input) => sendTemplateTest(ctx.actor, ctx.db, input),
      }),
    },
  },
});
