import { createFileRoute } from "@tanstack/react-router";
import { assetsReceivedAnswerSchema, withdrawInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { withdraw } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/withdraw")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.withdraw",
        input: withdrawInputSchema,
        output: assetsReceivedAnswerSchema,
        handler: (ctx, input) => withdraw(ctx.actor, ctx.db, input),
      }),
    },
  },
});
