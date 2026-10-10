import { createFileRoute } from "@tanstack/react-router";
import { inquiryListInputSchema, inquiryListSchema } from "../../../domain/admin-inquiries";
import { listInquiries } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "inquiries.list",
        input: inquiryListInputSchema,
        output: inquiryListSchema,
        handler: (ctx, input) => listInquiries(ctx.actor, ctx.db, input),
      }),
    },
  },
});
