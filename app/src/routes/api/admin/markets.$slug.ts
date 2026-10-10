import { createFileRoute } from "@tanstack/react-router";
import {
  marketDetailSchema,
  marketSavedSchema,
  marketSlugInputSchema,
  marketUpdateInputSchema,
} from "../../../domain/admin-markets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getMarket, updateMarket } from "../../../server/markets/service";

export const Route = createFileRoute("/api/admin/markets/$slug")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "markets.get",
        input: marketSlugInputSchema,
        output: marketDetailSchema,
        handler: (ctx, { slug }) => getMarket(ctx.actor, ctx.db, slug),
      }),
      PATCH: defineAdminRoute({
        method: "PATCH",
        action: "markets.edit",
        input: marketUpdateInputSchema,
        output: marketSavedSchema,
        handler: (ctx, input) => updateMarket(ctx.actor, ctx.db, input),
      }),
    },
  },
});
