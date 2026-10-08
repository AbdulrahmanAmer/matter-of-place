import { createFileRoute } from "@tanstack/react-router";
import { assetDecisionSchema, assetRejectInputSchema } from "../../../domain/admin-assets";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { rejectAsset } from "../../../server/assets/service";

export const Route = createFileRoute("/api/admin/assets/$id/reject")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "assets.reject",
        input: assetRejectInputSchema,
        output: assetDecisionSchema,
        handler: (ctx, input) => rejectAsset(ctx.actor, ctx.db, input),
      }),
    },
  },
});
