import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { settingsAnswerSchema } from "../../../domain/admin-settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getSettings } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "settings.get",
        input: z.object({}),
        output: settingsAnswerSchema,
        handler: (ctx) => getSettings(ctx.actor, ctx.db),
      }),
    },
  },
});
