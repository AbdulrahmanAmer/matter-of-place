import { z } from "zod";
import { loadSiteContext } from "../../email/context.ts";
import { renderTemplate } from "../../email/render.ts";
import type { Db } from "../../lib/db.ts";
import { sendOne, templateRow } from "../steps/send-email.ts";
import type { StepContext, StepResult, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// System job `market_open_notice` (B11 invariant 14, G15, G37, G58): the one mail an interest-only signup gets, when
// its market opens. Enqueued with the key `market_open:<market>` by B8b's `open_market_on_publish` and B7's
// `set_market_coming_soon`, so it exists once per market. `market_open` is bulk mail: `sendOne` stops at `bulk_cap`,
// this job returns that `retry_at`, and the resumed job skips every address already sent, so nobody gets it twice.

const input = z.object({ market: z.string().min(1) });

function rowsOf<T>(result: { data: T[] | null; error: unknown }, table: string): T[] {
  if (result.error !== null || result.data === null) {
    throw new Error(`newsletter_read_failed:${table}`);
  }
  return result.data;
}

async function marketName(db: Db, slug: string): Promise<string> {
  const [market] = rowsOf(
    await db.from("markets").select("name").eq("slug", slug).limit(1),
    "markets",
  );
  if (market === undefined) throw new NonRetryableError("market_missing");
  return market.name;
}

/** The market-open selection (R38): confirmed interest signups of the market that are still subscribed. */
async function interested(db: Db, market: string): Promise<{ id: string; email: string }[]> {
  return rowsOf(
    await db
      .from("subscribers")
      .select("id, email")
      .like("source", "interest:%")
      .contains("markets", [market])
      .not("confirmed_at", "is", null)
      .is("unsubscribed_at", null)
      .is("archived_at", null),
    "subscribers",
  );
}

async function run(ctx: StepContext, data: Record<string, unknown>): Promise<StepResult> {
  const parsed = input.safeParse(data);
  if (!parsed.success) throw new NonRetryableError("market_missing");
  const { market } = parsed.data;
  const { db } = ctx;
  const name = await marketName(db, market);
  const recipients = await interested(db, market);
  const row = await templateRow(db, "market_open");
  if (!row.enabled) return { status: "done", result: { skipped: "template_disabled" } };
  const site = await loadSiteContext(db);
  const rendered = await renderTemplate(
    row,
    { market_name: name, market_url: `${site.siteUrl}/${market}` },
    site,
  );
  let sent = 0;
  for (const { id, email } of recipients) {
    const outcome = await sendOne(ctx, {
      to: email,
      templateKey: "market_open",
      kind: "bulk",
      entity: "subscriber",
      entityId: id,
      rendered,
    });
    if (outcome.status === "retry_at") return outcome;
    if (outcome.status === "sent") sent += 1;
  }
  return { status: "done", result: { sent } };
}

export const marketOpenNotice: SystemJobDefinition = {
  type: "market_open_notice",
  sideEffect: "idempotency_key",
  maxAttempts: 12,
  run: (ctx, _params, data) => run(ctx, data),
};
