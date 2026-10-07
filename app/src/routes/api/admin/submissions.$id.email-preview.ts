import { createFileRoute } from "@tanstack/react-router";
import { emailPreviewAnswerSchema, emailPreviewSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { emailPreview } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/email-preview")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.email_preview",
        input: emailPreviewSchema,
        output: emailPreviewAnswerSchema,
        handler: (ctx, input) => emailPreview(ctx.actor, ctx.db, input),
      }),
    },
  },
});
