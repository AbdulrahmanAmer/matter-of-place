import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { signOut } from "../../../server/team/service";

// Signing out is open to anyone who may read `me`; the matrix has no separate action for it.
export const Route = createFileRoute("/api/admin/auth/sign-out")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "me",
        input: z.object({}),
        handler: (ctx) => signOut(ctx.actor, ctx.request),
      }),
    },
  },
});
