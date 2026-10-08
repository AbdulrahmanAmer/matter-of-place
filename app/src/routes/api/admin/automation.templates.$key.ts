import { createFileRoute } from "@tanstack/react-router";
import {
  getTemplate,
  putTemplate,
  templateKeyInput,
  templatePutInput,
} from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/templates/$key")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "automation.get",
        input: templateKeyInput,
        handler: (ctx, input) => getTemplate(ctx.actor, ctx.db, input),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "automation.templates_put",
        input: templatePutInput,
        handler: (ctx, input) => putTemplate(ctx.actor, ctx.db, input),
      }),
    },
  },
});
