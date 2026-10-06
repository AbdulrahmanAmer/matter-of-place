import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getMe } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/me")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "me",
        input: z.object({}),
        handler: (ctx) => getMe(ctx.actor, ctx.request, ctx.env),
      }),
    },
  },
});
