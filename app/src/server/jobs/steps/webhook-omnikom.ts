import { z } from "zod";
import type { Json } from "../../../db/index.ts";
import { deliver } from "../../omnikom/client.ts";
import { nextRetryAt } from "../../omnikom/ladder.ts";
import {
  buildInquiryPayload,
  deliveryId,
  type PayloadInquiry,
  type PayloadProperty,
} from "../../omnikom/payload.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// Forwards one inquiry to Omnikom (B15 Contract). The ladder of invariant 3 is ours: `retry_at` uses no B8 attempt, so
// `jobs.attempts` (moved only by `fail_job`) does not count the ladder; `jobs.result.delivery_attempts` does.

const INQUIRY_COLUMNS =
  "id, intent, topic, name, email, phone, location, message, details, source_path, received_at, subject_kind, subject_slug, subject_title, attribution, anonymised_at";

const paramsSchema = z.object({});
const dataSchema = z.object({ inquiry_id: z.string().uuid() });
/** What the last `retry_at` of this job stored: the exact body bytes and the attempts so far. */
const storedSchema = z
  .object({ delivery_attempts: z.number().int().min(0).optional(), body: z.string().optional() })
  .nullable();
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

const dbFailure = (what: string, error: { code: string }) =>
  new Error(`${what}_failed:${error.code}`);

/** The row, or null when it is missing or anonymised (invariant 3b: nothing is sent for it). */
async function loadInquiry(ctx: StepContext, inquiryId: string): Promise<PayloadInquiry | null> {
  const { data, error } = await ctx.db
    .from("inquiries")
    .select(INQUIRY_COLUMNS)
    .eq("id", inquiryId);
  if (error !== null) throw dbFailure("inquiries_read", error);
  const row = data[0];
  return row === undefined || row.anonymised_at !== null ? null : row;
}

/** The subject property in any editorial state, archived included, with its representative. */
async function loadSubject(ctx: StepContext, slug: string): Promise<PayloadProperty | null> {
  const { data, error } = await ctx.db
    .from("properties")
    .select("slug, title, market_slug, city, campaign_tier, presented_by_owner, representative_id")
    .eq("slug", slug);
  if (error !== null) throw dbFailure("properties_read", error);
  const row = data[0];
  if (row === undefined) return null;
  const { representative_id: representativeId, ...property } = row;
  if (property.presented_by_owner || representativeId === null) {
    return { ...property, representative: null };
  }
  const reps = await ctx.db
    .from("representatives")
    .select("name, brokerage")
    .eq("id", representativeId);
  if (reps.error !== null) throw dbFailure("representatives_read", reps.error);
  return { ...property, representative: reps.data[0] ?? null };
}

async function bodyOf(ctx: StepContext, inquiry: PayloadInquiry): Promise<string> {
  const property =
    inquiry.subject_kind === "property" && inquiry.subject_slug !== null
      ? await loadSubject(ctx, inquiry.subject_slug)
      : null;
  return JSON.stringify(await buildInquiryPayload(inquiry, property));
}

/** The one write of the step (G43). `false` means the row was anonymised or deleted while the call was in flight. */
async function markForwarded(ctx: StepContext, inquiryId: string, body: string): Promise<void> {
  const { data, error } = await ctx.db.rpc("mark_inquiry_forwarded", {
    p_inquiry_id: inquiryId,
    p_payload: jsonSchema.parse(JSON.parse(body)),
  });
  if (error !== null) throw dbFailure("mark_inquiry_forwarded", error);
  if (!data) throw new NonRetryableError("inquiry_gone");
}

async function run(ctx: StepContext, _params: unknown, data: JsonObject): Promise<StepResult> {
  const url = ctx.env["OMNIKOM_WEBHOOK_URL"];
  if (!url) return { status: "done", result: { skipped: "not_configured" } };
  // Deploy defects, not outages: neither walks the retry ladder.
  const secret = ctx.env["OMNIKOM_WEBHOOK_SECRET"];
  if (!secret) throw new NonRetryableError("omnikom_secret_missing");
  if (!URL.canParse(url)) throw new NonRetryableError("omnikom_url_invalid");
  const input = dataSchema.safeParse(data);
  if (!input.success) throw new NonRetryableError("inquiry_id_missing");
  const inquiryId = input.data.inquiry_id;

  const inquiry = await loadInquiry(ctx, inquiryId);
  if (inquiry === null) throw new NonRetryableError("inquiry_gone");
  // A retry of this job resends the stored bytes (invariant 2); a new job, recipe or manual, builds them from the row.
  const stored = storedSchema.parse(ctx.job.result);
  const body = stored?.body ?? (await bodyOf(ctx, inquiry));
  const id = await deliveryId(inquiryId);
  const attempts = (stored?.delivery_attempts ?? 0) + 1;

  const outcome = await deliver(body, { deliveryId: id, url, secret, now: ctx.now });
  if (outcome.kind === "refused") {
    throw new NonRetryableError(`omnikom_refused:${String(outcome.status)} ${outcome.detail}`);
  }
  if (outcome.kind === "retry") {
    const at = nextRetryAt(attempts, ctx.now, outcome.retryAfter);
    if (at === null) throw new NonRetryableError("omnikom_unreachable");
    return {
      status: "retry_at",
      at,
      reason: "omnikom_unavailable",
      result: {
        delivery_id: id,
        delivery_attempts: attempts,
        last_http_status: outcome.status,
        next_at: at.toISOString(),
        body,
      },
    };
  }
  await markForwarded(ctx, inquiryId, body);
  return {
    status: "done",
    result: { delivery_id: id, delivery_attempts: attempts, last_http_status: outcome.status },
  };
}

export const webhookOmnikom: StepDefinition<z.infer<typeof paramsSchema>> = {
  type: "webhook_omnikom",
  heavy: false,
  paramsSchema,
  run,
};
