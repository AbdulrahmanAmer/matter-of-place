import { createFileRoute } from "@tanstack/react-router";
import { resendEmailAnswerSchema, resendEmailInputSchema } from "../../../domain/admin-emails";
import { resendSubmissionEmail } from "../../../server/email/sent";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W9 item 2: a bounced email about a request goes again, to the address the person corrected.
export const Route = createFileRoute("/api/admin/submissions/$id/resend-email")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.resend_email",
        input: resendEmailInputSchema,
        output: resendEmailAnswerSchema,
        handler: (ctx, input) => resendSubmissionEmail(ctx.actor, ctx.db, input),
      }),
    },
  },
});
