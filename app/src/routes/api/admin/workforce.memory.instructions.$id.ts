import { createFileRoute } from "@tanstack/react-router";
import { instructionIdSchema, instructionTextSchema } from "../../../domain/admin-team-memory";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { instructionText } from "../../../server/workforce/service";

// W7 item 4: the text of one version of a colleague's instructions, read when a person opens it.
export const Route = createFileRoute("/api/admin/workforce/memory/instructions/$id")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: instructionIdSchema,
        output: instructionTextSchema,
        handler: (ctx, { id }) => instructionText(ctx.actor, ctx.db, id),
      }),
    },
  },
});
