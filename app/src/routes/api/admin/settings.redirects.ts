import { createFileRoute } from "@tanstack/react-router";
import {
  redirectArchiveInput,
  redirectArchivedSchema,
  redirectListInput,
  redirectPageSchema,
  redirectPutInput,
  redirectRowSchema,
} from "../../../domain/admin-settings";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { archiveRedirect, listRedirects, putRedirect } from "../../../server/settings/service";

export const Route = createFileRoute("/api/admin/settings/redirects")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "settings.redirects_get",
        input: redirectListInput,
        output: redirectPageSchema,
        handler: (ctx, input) => listRedirects(ctx.actor, ctx.db, input),
      }),
      PUT: defineAdminRoute({
        method: "PUT",
        action: "settings.redirects_put",
        input: redirectPutInput,
        output: redirectRowSchema,
        handler: (ctx, input) => putRedirect(ctx.actor, ctx.db, input),
      }),
      DELETE: defineAdminRoute({
        method: "DELETE",
        action: "settings.redirects_put",
        input: redirectArchiveInput,
        output: redirectArchivedSchema,
        handler: (ctx, input) => archiveRedirect(ctx.actor, ctx.db, input),
      }),
    },
  },
});
