import { z } from "zod";

// The campaign reports of screen 22 (B10 step 9, G22). One row is one campaign and one ISO week; the numbers are the
// ones `buildCampaignReport` stored. A figure the system does not measure is absent or null, never 0.

/** Rows per page of `GET /api/admin/reports`. */
export const reportPageSize = 50;

export const reportFilters = z.object({
  campaign_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ReportFilters = z.output<typeof reportFilters>;

/** The path parameter of `GET /api/admin/reports/:id` and `POST /api/admin/reports/:id/email`. */
export const reportIdInput = z.object({ id: z.string().uuid() });

/** The fields of one channel of `channel_mix`; a field a channel did not return is left out. */
const channelFigures = z.record(z.string(), z.number());

export const reportSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  property_name: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  media_spend: z.number(),
  impressions: z.number(),
  reach: z.number(),
  clicks: z.number(),
  video_views: z.number().nullable(),
  ctr: z.number().nullable(),
  geography: z.record(z.string(), z.unknown()),
  channel_mix: z.record(z.string(), channelFigures),
  owned_distribution: z.object({
    newsletter_issues: z.number().default(0),
    newsletter_clicks: z.number().default(0),
  }),
  top_creative: z.string().nullable(),
});

export type Report = z.infer<typeof reportSchema>;

export const reportListSchema = z.object({
  items: z.array(reportSchema),
  total: z.number().int().min(0),
});

/** `POST /api/admin/reports/:id/email`: the queued job, or null inside the minute of an earlier click. */
export const reportEmailAnswer = z.object({
  job_id: z.string().nullable(),
  duplicate: z.boolean().optional(),
});
