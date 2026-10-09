import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { assigneesSchema } from "../../../domain/admin-inquiries";
import { listAssignees } from "../../../server/inquiries/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/inquiries/assignees")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "inquiries.assignees",
        input: z.object({}),
        output: assigneesSchema,
        handler: (ctx) => listAssignees(ctx.actor, ctx.db),
      }),
    },
  },
});
