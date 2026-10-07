import { createFileRoute } from "@tanstack/react-router";
import { assetIdInputSchema, assetRerenderSchema } from "../../../domain/admin-assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { rerenderAsset } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/$id/rerender")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "assets.re_render",
        input: assetIdInputSchema,
        output: assetRerenderSchema,
        handler: (ctx, input) => rerenderAsset(ctx.actor, ctx.db, input),
      }),
    },
  },
});
