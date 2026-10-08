import { createFileRoute } from "@tanstack/react-router";
import { decisionAnswerSchema, requestAssetsInputSchema } from "../../../domain/admin-submissions";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { requestAssets } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/request-assets")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.request_assets",
        input: requestAssetsInputSchema,
        output: decisionAnswerSchema,
        handler: (ctx, input) => requestAssets(ctx.actor, ctx.db, input),
      }),
    },
  },
});
