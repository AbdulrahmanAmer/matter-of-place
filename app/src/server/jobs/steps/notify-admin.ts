import { stepSpecs } from "../../automation/step-specs.ts";
import { loadSiteContext, resolveAdminRecipients } from "../../email/context.ts";
import { renderTemplate } from "../../email/render.ts";
import { resolveVariables, WaitFor, type Variables } from "../../email/variables.ts";
import {
  NonRetryableError,
  type JsonObject,
  type StepContext,
  type StepDefinition,
  type StepResult,
} from "../types.ts";
import {
  eventTypeOf,
  isTemplateKey,
  jobIdempotencyKey,
  reportAlert,
  sendEach,
  templateRow,
} from "./send-email.ts";

// Step `notify_admin`: one notice to every admin address, one message row and one Idempotency-Key each. Mail can stop
// (Resend down, key revoked, quota spent), so every alert goes to Sentry first, grouped by its key (INT-04).

const spec = stepSpecs.notify_admin;

/** What Sentry records for an alert: the headline is the message. */
class AlertRaised extends Error {
  constructor(headline: string) {
    super(headline);
    this.name = "AlertRaised";
  }
}

/** The triggering event's type, else the job's idempotency key up to its second `:`. */
async function alertKey(ctx: StepContext, eventType: string | undefined): Promise<string> {
  if (eventType !== undefined) return eventType;
  return (await jobIdempotencyKey(ctx)).split(":").slice(0, 2).join(":");
}

async function run(ctx: StepContext, params: unknown, data: JsonObject): Promise<StepResult> {
  const parsed = spec.paramsSchema.parse(params);
  const key = parsed["template"];
  if (!isTemplateKey(key)) throw new NonRetryableError("template_unknown");
  const headline = parsed["headline"];
  const eventType = await eventTypeOf(ctx);
  const row = await templateRow(ctx.db, key);
  const site = await loadSiteContext(ctx.db);
  let variables: Variables;
  try {
    variables = await resolveVariables(
      ctx.db,
      key,
      data,
      eventType,
      site,
      typeof headline === "string" ? headline : undefined,
      { eventId: ctx.job.eventId, now: ctx.now },
    );
  } catch (error) {
    // A notice that waits for a sibling job ends here, with no attempt used; every other error is the runner's.
    if (error instanceof WaitFor) return { status: "retry_at", at: error.at, reason: error.reason };
    throw error;
  }
  const fingerprint = ["alert", await alertKey(ctx, eventType)];
  await reportAlert(
    ctx,
    new AlertRaised(variables["headline"] ?? fingerprint.join(":")),
    fingerprint,
  );
  if (!row.enabled) return { status: "done", result: { skipped: "template_disabled" } };
  const rendered = await renderTemplate(row, variables, site);
  return sendEach(ctx, await resolveAdminRecipients(ctx.db), {
    templateKey: key,
    kind: "alert",
    rendered,
  });
}

export const notifyAdmin: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
};
