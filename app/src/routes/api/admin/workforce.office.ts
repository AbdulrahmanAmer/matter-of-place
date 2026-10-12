import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { officeSchema } from "../../../domain/workforce";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getOffice } from "../../../server/workforce/service";

// W1: the office at a glance: every employee, its state and current task, the latest runs, pending approvals.
export const Route = createFileRoute("/api/admin/workforce/office")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: z.object({}),
        output: officeSchema,
        handler: (ctx) => getOffice(ctx.actor, ctx.db),
      }),
    },
  },
});
