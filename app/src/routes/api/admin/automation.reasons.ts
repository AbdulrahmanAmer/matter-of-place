import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createReason, getReasons, reasonCreateInput } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/reasons")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: z.object({}),
        handler: (ctx) => getReasons(ctx.actor, ctx.db),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "automation.reasons_put",
        input: reasonCreateInput,
        handler: (ctx, input) => createReason(ctx.actor, ctx.db, input),
      }),
    },
  },
});
