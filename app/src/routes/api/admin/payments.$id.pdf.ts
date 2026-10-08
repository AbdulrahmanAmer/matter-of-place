import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getPdf, pathId } from "../../../server/payments/service";

// A 302 to a 60 second signed URL: the Worker never streams the PDF. The wrapper adds `private, no-store`.
export const Route = createFileRoute("/api/admin/payments/$id/pdf")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "payments.pdf",
        input: pathId,
        handler: async (ctx, input) =>
          new Response(null, {
            status: 302,
            headers: { location: await getPdf(ctx.actor, ctx.db, input) },
          }),
      }),
    },
  },
});
