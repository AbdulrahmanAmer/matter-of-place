import { createFileRoute } from "@tanstack/react-router";
import { productsPreviewSchema } from "../../../domain/admin-settings";
import { productsSettingSchema } from "../../../domain/exposure";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { previewProductsSetting } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/products/preview")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "settings.products_preview",
        input: productsSettingSchema,
        output: productsPreviewSchema,
        handler: (ctx, input) => previewProductsSetting(ctx.actor, ctx.db, input),
      }),
    },
  },
});
