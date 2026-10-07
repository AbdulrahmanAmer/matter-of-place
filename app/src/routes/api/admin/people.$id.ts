import { createFileRoute } from "@tanstack/react-router";
import { personDetailSchema, personIdInputSchema } from "../../../domain/admin-people";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { getPerson } from "../../../server/people/service";

export const Route = createFileRoute("/api/admin/people/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "people.get",
        input: personIdInputSchema,
        output: personDetailSchema,
        handler: (ctx, input) => getPerson(ctx.actor, ctx.db, input.id),
      }),
    },
  },
});
