import { createFileRoute } from "@tanstack/react-router";
import { adminAssetSchema, assetIdInputSchema } from "../../../domain/admin-assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getAsset } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "assets.get",
        input: assetIdInputSchema,
        output: adminAssetSchema,
        handler: (ctx, input) => getAsset(ctx.actor, ctx.db, input),
      }),
    },
  },
});
