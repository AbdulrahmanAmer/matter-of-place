import { createFileRoute } from "@tanstack/react-router";
import {
  createFromSubmissionAnswerSchema,
  createFromSubmissionInputSchema,
} from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { createFromSubmission } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/from-submission")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.create_from_submission",
        input: createFromSubmissionInputSchema,
        output: createFromSubmissionAnswerSchema,
        handler: (ctx, input) => createFromSubmission(ctx.actor, ctx.db, input.submission_id),
      }),
    },
  },
});
