import { createFileRoute } from "@tanstack/react-router";
import {
  agentPreviewAnswerSchema,
  agentPreviewInputSchema,
} from "../../../domain/admin-properties";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { issueAgentPreview } from "../../../server/properties/service";

export const Route = createFileRoute("/api/admin/properties/$id/agent-preview")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "properties.agent_preview",
        input: agentPreviewInputSchema,
        output: agentPreviewAnswerSchema,
        handler: (ctx, input) =>
          issueAgentPreview(ctx.actor, ctx.db, input, ctx.env.PREVIEW_TOKEN_SECRET),
      }),
    },
  },
});
