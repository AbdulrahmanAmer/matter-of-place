import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { lessonListSchema } from "../../../domain/admin-team-memory";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listLessons } from "../../../server/workforce/service";

// W7 item 4: what each colleague, or the whole team, was taught (read only).
export const Route = createFileRoute("/api/admin/workforce/memory/lessons")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.office",
        input: z.object({}),
        output: lessonListSchema,
        handler: (ctx) => listLessons(ctx.actor, ctx.db),
      }),
    },
  },
});
