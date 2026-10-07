import { createFileRoute } from "@tanstack/react-router";
import { peopleListInputSchema, peopleListSchema } from "../../../domain/admin-people";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listPeople } from "../../../server/people/service";

export const Route = createFileRoute("/api/admin/people/")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "people.list",
        input: peopleListInputSchema,
        output: peopleListSchema,
        handler: (ctx, input) => listPeople(ctx.actor, ctx.db, input),
      }),
    },
  },
});
