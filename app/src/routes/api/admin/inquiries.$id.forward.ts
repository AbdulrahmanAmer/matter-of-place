import { createFileRoute } from "@tanstack/react-router";
import { forwardAnswerSchema, inquiryIdInputSchema } from "../../../domain/admin-inquiries";
import { forward } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/$id/forward")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "inquiries.forward",
        input: inquiryIdInputSchema,
        output: forwardAnswerSchema,
        handler: (ctx, { id }) => forward(ctx.actor, ctx.db, id),
      }),
    },
  },
});
