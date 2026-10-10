import { createFileRoute } from "@tanstack/react-router";
import { inquiryDetailSchema, inquiryIdInputSchema } from "../../../domain/admin-inquiries";
import { getInquiry } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "inquiries.get",
        input: inquiryIdInputSchema,
        output: inquiryDetailSchema,
        handler: (ctx, { id }) => getInquiry(ctx.actor, ctx.db, id),
      }),
    },
  },
});
