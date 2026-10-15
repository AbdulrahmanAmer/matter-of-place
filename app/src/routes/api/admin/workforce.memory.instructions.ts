import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { instructionVersionListSchema } from "../../../domain/admin-team-memory";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listInstructionVersions } from "../../../server/workforce/service";

// W7 item 4: the versions of every colleague's instructions, newest first, without their text (read only).
export const Route = createFileRoute("/api/admin/workforce/memory/instructions")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: z.object({}),
        output: instructionVersionListSchema,
        handler: (ctx) => listInstructionVersions(ctx.actor, ctx.db),
      }),
    },
  },
});
