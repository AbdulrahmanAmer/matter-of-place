import { createFileRoute } from "@tanstack/react-router";
import { noteInputSchema, submissionNoteSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { addNote } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/note")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.note",
        input: noteInputSchema,
        output: submissionNoteSchema,
        handler: (ctx, input) => addNote(ctx.actor, ctx.db, input),
      }),
    },
  },
});
