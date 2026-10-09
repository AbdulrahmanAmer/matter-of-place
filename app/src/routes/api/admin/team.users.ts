import { createFileRoute } from "@tanstack/react-router";
import {
  inviteInputSchema,
  teamUsersInputSchema,
  teamUsersPageSchema,
  userCreatedSchema,
} from "../../../domain/admin-team";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { inviteUser, listUsers } from "../../../server/team/service";

export const Route = createFileRoute("/api/admin/team/users")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "team.users_list",
        input: teamUsersInputSchema,
        output: teamUsersPageSchema,
        handler: (ctx, page) => listUsers(ctx.actor, ctx.db, page),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "team.invite",
        input: inviteInputSchema,
        output: userCreatedSchema,
        handler: (ctx, input) => inviteUser(ctx.actor, ctx.db, input),
      }),
    },
  },
});
