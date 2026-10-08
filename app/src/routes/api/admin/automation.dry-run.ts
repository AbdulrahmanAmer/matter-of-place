import { createFileRoute } from "@tanstack/react-router";
import { dryRunInput, runDryRun } from "../../../server/automation/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

export const Route = createFileRoute("/api/admin/automation/dry-run")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "automation.dry_run",
        input: dryRunInput,
        handler: (ctx, input) => runDryRun(ctx.actor, ctx.db, input),
      }),
    },
  },
});
