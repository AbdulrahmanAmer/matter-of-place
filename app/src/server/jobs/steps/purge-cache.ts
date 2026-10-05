import { z } from "zod";
import type { Json } from "../../../db/index.ts";
import { stepSpecs } from "../../automation/step-specs.ts";
import { readVar } from "../../lib/runtime-env.ts";
import type { StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// Asks Cloudflare's edge cache to forget what changed (F24). Housekeeping only: the cache key carries `catalog_version`,
// so no page is ever wrong without it (architecture 13 rule 4). With no token or zone the step ends `done` and skips.

const spec = stepSpecs.purge_cache;
const MAX_URLS_PER_CALL = 30;
const DEFAULT_RETRY_AFTER_S = 60;

type Scope = "catalog" | "property" | "all";

const isScope = (value: unknown): value is Scope =>
  value === "catalog" || value === "property" || value === "all";

/** `property` has no narrower tag yet, so it purges what `catalog` does (B13 adds the document tags). */
export function purgeBody(scope: Scope): Json {
  return scope === "all" ? { purge_everything: true } : { tags: ["catalog"] };
}

type Outcome = { kind: "skipped" } | { kind: "done" } | { kind: "retry"; at: Date };

const answerSchema = z.object({ success: z.boolean() });

/** One purge call. A 5xx or a network error throws and the runner's backoff retries; any other refusal is final. */
async function send(ctx: StepContext, body: Json): Promise<Outcome> {
  const token = readVar("CF_PURGE_TOKEN");
  const zone = readVar("CF_ZONE_ID");
  if (!token || !zone) return { kind: "skipped" };
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    const wait = seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_S;
    return { kind: "retry", at: new Date(ctx.now.getTime() + wait * 1000) };
  }
  if (response.status >= 500) throw new Error(`cloudflare_purge_${String(response.status)}`);
  if (!response.ok) throw new NonRetryableError(`cloudflare_purge_${String(response.status)}`);
  const answer = answerSchema.safeParse(await response.json());
  if (!answer.success || !answer.data.success)
    throw new NonRetryableError("cloudflare_purge_refused");
  return { kind: "done" };
}

async function run(ctx: StepContext, params: unknown): Promise<StepResult> {
  const scope = spec.paramsSchema.parse(params)["scope"];
  const outcome = await send(ctx, purgeBody(isScope(scope) ? scope : "catalog"));
  if (outcome.kind === "skipped") return { status: "done", result: { skipped: "not_configured" } };
  if (outcome.kind === "retry") {
    return { status: "retry_at", at: outcome.at, reason: "cf_rate_limited" };
  }
  return { status: "done" };
}

/** Purges public addresses for B8's `takedown_media` job, at most 30 to a call; a rate limit throws and the job's backoff retries. */
export async function purgeUrls(
  urls: readonly string[],
  ctx: StepContext,
): Promise<{ purged: number; skipped?: "not_configured" }> {
  let purged = 0;
  for (let from = 0; from < urls.length; from += MAX_URLS_PER_CALL) {
    const files = urls.slice(from, from + MAX_URLS_PER_CALL);
    const outcome = await send(ctx, { files });
    if (outcome.kind === "skipped") return { purged: 0, skipped: "not_configured" };
    if (outcome.kind === "retry") throw new Error("cloudflare_purge_rate_limited");
    purged += files.length;
  }
  return { purged };
}

export const purgeCache: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
};
