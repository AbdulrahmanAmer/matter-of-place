// What `meta-test-post.ts` and `social-test-post.ts` share (B10 invariant 1): the script never calls a platform. It
// enqueues the channel's step job for one approved asset with `respect_window: false`, then polls `social_posts` and
// prints the outcome. The job writes the row like any other, so a recipe job for the same asset and channel finds it
// `posted` and ends. Test commands refuse after the launch switch (ruling H35 (5)).
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { defaultMaxAttempts, stepSpecs } from "../../src/server/automation/step-specs.ts";
import { holdDevLock } from "../../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./assert-not-production.mjs";
import { devDb, type DevDb } from "./dev-db.ts";
import { guardEnv } from "./guard-env.mjs";
import { assertDevTarget } from "./social-script.ts";

const POLL_MS = 5000;
const GIVE_UP_MS = 180_000;

export type TestChannel = "instagram" | "x" | "linkedin";

const STEPS = {
  instagram: { type: "post_meta", params: { channels: ["instagram"], respect_window: false } },
  x: { type: "post_x", params: { respect_window: false } },
  linkedin: { type: "post_linkedin", params: { respect_window: false } },
} as const;

const assets = z.array(z.object({ property_id: z.string(), kind: z.string(), status: z.string() }));
const properties = z.array(z.object({ campaign_tier: z.string(), market_slug: z.string() }));
const posts = z.array(
  z.object({
    status: z.string(),
    permalink: z.string().nullable(),
    error: z.string().nullable(),
  }),
);

async function post(db: DevDb, channel: TestChannel, assetId: string): Promise<number> {
  const asset = (
    await db.select("assets", `id=eq.${assetId}&select=property_id,kind,status`, assets)
  )[0];
  if (asset === undefined) {
    console.log(`failed ${channel} asset not found`);
    return 1;
  }
  if (asset.status !== "approved") {
    console.log(`failed ${channel} asset is ${asset.status}, not approved`);
    return 1;
  }
  const property = (
    await db.select(
      "properties",
      `id=eq.${asset.property_id}&select=campaign_tier,market_slug`,
      properties,
    )
  )[0];
  if (property === undefined) {
    console.log(`failed ${channel} property not found`);
    return 1;
  }
  const step = STEPS[channel];
  await db.rpc(
    "enqueue_job",
    {
      p_type: step.type,
      p_payload: {
        params: step.params,
        data: {
          asset_id: assetId,
          property_id: asset.property_id,
          kind: asset.kind,
          tier: property.campaign_tier,
          market: property.market_slug,
        },
      },
      p_idempotency_key: `test_post:${channel}:${assetId}`,
      p_heavy: false,
      p_max_attempts: stepSpecs[step.type].maxAttempts ?? defaultMaxAttempts,
    },
    z.string().nullable(),
  );
  for (let waited = 0; waited <= GIVE_UP_MS; waited += POLL_MS) {
    const row = (
      await db.select(
        "social_posts",
        `asset_id=eq.${assetId}&channel=eq.${channel}&select=status,permalink,error`,
        posts,
      )
    )[0];
    if (row?.status === "posted") {
      console.log(`posted ${channel} ${row.permalink ?? ""}`.trimEnd());
      return 0;
    }
    if (row?.status === "failed") {
      console.log(`failed ${channel} ${row.error ?? "no reason recorded"}`);
      return 1;
    }
    await sleep(POLL_MS);
  }
  console.log(`failed ${channel} no result within ${String(GIVE_UP_MS / 1000)} seconds`);
  return 1;
}

/** The whole command: `allowed` lists the channels the script serves; with one of them `--channel` is optional. */
export async function testPostMain(allowed: readonly TestChannel[]): Promise<number> {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      asset: { type: "string" },
      channel: { type: "string" },
      "i-mean-it": { type: "boolean" },
    },
    strict: true,
  });
  if (values["i-mean-it"] !== true) {
    console.log("refused: --i-mean-it required");
    return 1;
  }
  const wanted = values.channel ?? (allowed.length === 1 ? allowed[0] : undefined);
  const channel = allowed.find((candidate) => candidate === wanted);
  const asset = z.string().uuid().safeParse(values.asset);
  if (channel === undefined || !asset.success) {
    console.log(`refused: --channel ${allowed.join("|")} and --asset <uuid> required`);
    return 1;
  }
  guardEnv();
  assertDevTarget(values.target);
  await assertNotProduction();
  const release = await holdDevLock();
  try {
    return await post(devDb(), channel, asset.data);
  } finally {
    await release();
  }
}
