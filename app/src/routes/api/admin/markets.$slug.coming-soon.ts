import { createFileRoute } from "@tanstack/react-router";
import { comingSoonAnswerSchema, comingSoonInputSchema } from "../../../domain/admin-markets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setComingSoon } from "../../../server/markets/service";

export const Route = createFileRoute("/api/admin/markets/$slug/coming-soon")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "markets.coming_soon",
        input: comingSoonInputSchema,
        output: comingSoonAnswerSchema,
        handler: (ctx, input) => setComingSoon(ctx.actor, ctx.db, input),
      }),
    },
  },
});
