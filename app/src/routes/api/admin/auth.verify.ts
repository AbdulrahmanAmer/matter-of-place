import { createFileRoute } from "@tanstack/react-router";
import { verifyInput } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { verifySignIn } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/auth/verify")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "auth.verify",
        auth: "none",
        body: "form",
        input: verifyInput,
        handler: (ctx, input) => verifySignIn(ctx.db, ctx.request, ctx.env, input),
      }),
    },
  },
});
