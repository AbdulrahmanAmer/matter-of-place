import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { marketListSchema } from "../../../domain/admin-markets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listMarkets } from "../../../server/markets/service";

export const Route = createFileRoute("/api/admin/markets/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "markets.list",
        input: z.object({}),
        output: marketListSchema,
        handler: (ctx) => listMarkets(ctx.actor, ctx.db),
      }),
    },
  },
});
