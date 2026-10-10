import { createFileRoute } from "@tanstack/react-router";
import {
  assignInquiryInputSchema,
  inquiryStateAnswerSchema,
} from "../../../domain/admin-inquiries";
import { assign } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/$id/assign")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "inquiries.assign",
        input: assignInquiryInputSchema,
        output: inquiryStateAnswerSchema,
        handler: (ctx, { id, assignee }) => assign(ctx.actor, ctx.db, id, assignee),
      }),
    },
  },
});
