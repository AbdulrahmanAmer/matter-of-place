import { createFileRoute } from "@tanstack/react-router";
import { inquiryIdInputSchema, inquiryStateAnswerSchema } from "../../../domain/admin-inquiries";
import { close } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/$id/close")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "inquiries.close",
        input: inquiryIdInputSchema,
        output: inquiryStateAnswerSchema,
        handler: (ctx, { id }) => close(ctx.actor, ctx.db, id),
      }),
    },
  },
});
