import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { declineReasonsAnswerSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listDeclineReasons } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/decline-reasons")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "submissions.decline_reasons",
        input: z.object({}),
        output: declineReasonsAnswerSchema,
        handler: (ctx) => listDeclineReasons(ctx.actor, ctx.db),
      }),
    },
  },
});
