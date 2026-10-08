import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { exportSubscribers } from "../../../server/newsletter/service";

export const Route = createFileRoute("/api/admin/newsletter/subscribers/export")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.subscribers_export",
        input: z.object({}),
        handler: async (ctx) =>
          new Response(await exportSubscribers(ctx.actor, ctx.db), {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename=subscribers-${new Date().toISOString().slice(0, 10)}.csv`,
            },
          }),
      }),
    },
  },
});
