import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { interestSchema } from "../../../domain/admin-newsletter";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listInterest } from "../../../server/newsletter/service";

// The Interest screen (operator, 2026-10-15): every signup and the totals per market. The same right and the same
// audited read as the subscriber CSV.
export const Route = createFileRoute("/api/admin/newsletter/interest")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "newsletter.subscribers_export",
        input: z.object({}),
        output: interestSchema,
        handler: (ctx) => listInterest(ctx.actor, ctx.db),
      }),
    },
  },
});
