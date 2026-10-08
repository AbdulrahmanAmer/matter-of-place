import { createFileRoute } from "@tanstack/react-router";
import { previewEmailTemplate, templatePreviewInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/templates/preview")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "automation.templates_preview",
        input: templatePreviewInput,
        handler: (ctx, input) => previewEmailTemplate(ctx.actor, ctx.db, input),
      }),
    },
  },
});
