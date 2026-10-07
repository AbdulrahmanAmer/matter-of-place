import { createFileRoute } from "@tanstack/react-router";
import { personNotesAnswerSchema, personNotesInputSchema } from "../../../domain/admin-people";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { setPersonNotes } from "../../../server/people/service";

export const Route = createFileRoute("/api/admin/people/$id/notes")({
  server: {
    handlers: {
      PUT: defineAdminRoute({
        method: "PUT",
        action: "people.note",
        input: personNotesInputSchema,
        output: personNotesAnswerSchema,
        handler: (ctx, { id, ...notes }) => setPersonNotes(ctx.actor, ctx.db, id, notes),
      }),
    },
  },
});
