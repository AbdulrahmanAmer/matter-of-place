import { createFileRoute } from "@tanstack/react-router";
import { productsSettingSchema } from "../../../domain/exposure";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { putProductsSetting } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/products")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.products_put",
        input: productsSettingSchema,
        output: productsSettingSchema,
        handler: (ctx, input) => putProductsSetting(ctx.actor, ctx.db, input),
      }),
    },
  },
});
