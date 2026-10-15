import { z } from "zod";
import {
  campaignListLimit,
  channelStatusSchema,
  type Campaign,
  type CampaignList,
} from "../../domain/admin-campaigns.ts";
import { exposurePackages } from "../../domain/contracts.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";

// Screen 33 (W7 item 3). The read is allowed to whoever may read reports (`reports.list`): the list exists to reach a
// campaign's report. Nothing here writes; a campaign row is created only by `activate_submission` (G22).

const CAMPAIGN_COLUMNS =
  "id, property_id, package, media_budget, management_fee, starts_on, ends_on, homepage_status, featured_status, newsletter_status, social_status, programmatic_status, properties!inner(title, market_slug), campaign_reports(count)";

const joined = z
  .object({
    id: z.string().uuid(),
    property_id: z.string().uuid(),
    package: z.enum(exposurePackages),
    media_budget: z.number(),
    management_fee: z.number(),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    homepage_status: channelStatusSchema,
    featured_status: channelStatusSchema,
    newsletter_status: channelStatusSchema,
    social_status: channelStatusSchema,
    programmatic_status: channelStatusSchema,
    properties: z.object({ title: z.string(), market_slug: z.string() }),
    campaign_reports: z.array(z.object({ count: z.number().int().min(0) })),
  })
  .transform((row): Campaign => ({
    id: row.id,
    property_id: row.property_id,
    property_title: row.properties.title,
    market_slug: row.properties.market_slug,
    package: row.package,
    media_budget: row.media_budget,
    management_fee: row.management_fee,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    channels: {
      homepage: row.homepage_status,
      featured: row.featured_status,
      newsletter: row.newsletter_status,
      social: row.social_status,
      programmatic: row.programmatic_status,
    },
    report_count: row.campaign_reports[0]?.count ?? 0,
  }));

/**
 * `GET /api/admin/campaigns`: the newest campaigns first, at most `campaignListLimit`, with the count of all. It
 * takes no offset, so it cannot ask PostgREST for a range past the last row (G-252).
 */
export async function listCampaigns(actor: AdminActor, db: Db): Promise<CampaignList> {
  authorize(actor, "reports.list");
  const { data, error, count } = await db
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(campaignListLimit);
  if (error !== null) throw fromRpcError(error);
  return { items: z.array(joined).parse(data), total: count ?? 0 };
}
