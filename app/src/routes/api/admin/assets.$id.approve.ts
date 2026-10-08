import { createFileRoute } from "@tanstack/react-router";
import { assetDecisionSchema, assetIdInputSchema } from "../../../domain/admin-assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { approveAsset } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/$id/approve")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "assets.approve",
        input: assetIdInputSchema,
        output: assetDecisionSchema,
        handler: (ctx, input) => approveAsset(ctx.actor, ctx.db, input),
      }),
    },
  },
});
