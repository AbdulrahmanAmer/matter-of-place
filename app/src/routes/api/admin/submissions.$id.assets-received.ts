import { createFileRoute } from "@tanstack/react-router";
import {
  assetsReceivedAnswerSchema,
  submissionIdInputSchema,
} from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { assetsReceived } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/assets-received")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.assets_received",
        input: submissionIdInputSchema,
        output: assetsReceivedAnswerSchema,
        handler: (ctx, input) => assetsReceived(ctx.actor, ctx.db, input),
      }),
    },
  },
});
