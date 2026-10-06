import { createFileRoute } from "@tanstack/react-router";
import { sendLinkInput } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { sendSignInLink } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/auth/send-link")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "auth.send_link",
        auth: "none",
        input: sendLinkInput,
        handler: (ctx, input) => sendSignInLink(ctx.db, ctx.request, ctx.env, input),
      }),
    },
  },
});
