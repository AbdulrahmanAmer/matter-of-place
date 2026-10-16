import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { campaignListSchema } from "../../../domain/admin-campaigns";
import { listCampaigns } from "../../../server/campaigns/service";
import { defineAdminRoute } from "../../../server/lib/admin-route";

// W7 item 3: the Campaigns list, read only, with the right of the Reports screen it leads to.
export const Route = createFileRoute("/api/admin/campaigns")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "reports.list",
        input: z.object({}),
        output: campaignListSchema,
        handler: (ctx) => listCampaigns(ctx.actor, ctx.db),
      }),
    },
  },
});
