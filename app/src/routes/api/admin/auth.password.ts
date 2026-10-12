import { createFileRoute } from "@tanstack/react-router";
import { passwordSignInInput } from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { signInWithPassword } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/auth/password")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "auth.password",
        auth: "none",
        input: passwordSignInInput,
        handler: (ctx, input) => signInWithPassword(ctx.db, ctx.request, ctx.env, input),
      }),
    },
  },
});
