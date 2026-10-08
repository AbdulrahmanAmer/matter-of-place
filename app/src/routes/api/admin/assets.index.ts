import { createFileRoute } from "@tanstack/react-router";
import { assetListSchema } from "../../../domain/admin-assets";
import { assetListFilters } from "../../../domain/assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listAssets } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "assets.list",
        input: assetListFilters,
        output: assetListSchema,
        handler: (ctx, input) => listAssets(ctx.actor, ctx.db, input),
      }),
    },
  },
});
