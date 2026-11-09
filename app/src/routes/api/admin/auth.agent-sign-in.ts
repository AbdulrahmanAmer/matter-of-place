import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { issueAgentSignIn } from "../../../server/team/service";

// H151: an agent key takes a one-time sign-in token for its own account (Matter's laptop browser).
export const Route = createFileRoute("/api/admin/auth/agent-sign-in")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "dashboard.agent_sign_in",
        input: z.object({}),
        handler: (ctx) => issueAgentSignIn(ctx.actor, ctx.db),
      }),
    },
  },
});
