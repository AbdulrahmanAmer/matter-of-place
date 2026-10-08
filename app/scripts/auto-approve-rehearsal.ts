// B10 step 10: the approval-mode cutover rehearsal on `mop-dev`, before the launch switch, with SOCIAL_DRY_RUN set on
// the job runner so no platform is called. `bun run scripts/auto-approve-rehearsal.ts [--target dev]` switches the
// `instagram` row to Feature `auto` (the enable guard is bypassed on purpose: no Meta account exists, E9), inserts two
// pending fixture carousels for a published Feature and a published Campaign property, runs `maybeAutoApprove` on
// both and prints `approved <id>` or `not_eligible <id> <reason>`. It then waits for the dry-run post step to write the
// Feature asset's `social_posts` row, because the step reads the channel row and refuses an automatic approval once
// the row is back to `manual`, and restores the `instagram` row. The fixture rows stay, marked `meta.fixture`.
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { channelSettingsSchema } from "../src/domain/automation.ts";
import type { Database } from "../src/db/index.ts";
import { maybeAutoApprove } from "../src/server/channels/auto-approve.ts";
import type { Db } from "../src/server/lib/db.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";
import { assertDevTarget, runScript } from "./lib/social-script.ts";
import { devProject } from "./lib/storage-env.ts";

const POLL_MS = 5000;
const GIVE_UP_MS = 150_000;
const DAY_MS = 86_400_000;

const instagramSchema = channelSettingsSchema.pick({
  enabled: true,
  approval_mode: true,
  auto_after: true,
});
type InstagramRow = z.infer<typeof instagramSchema>;

const unavailable = (what: string) => new Error(`database did not answer (${what})`);

async function readInstagram(db: Db): Promise<InstagramRow> {
  const { data, error } = await db
    .from("channel_settings")
    .select("enabled, approval_mode, auto_after")
    .eq("channel", "instagram")
    .limit(1);
  if (error !== null) throw unavailable("channel_settings");
  return instagramSchema.parse(data[0]);
}

async function writeInstagram(db: Db, row: InstagramRow): Promise<void> {
  const { error } = await db.from("channel_settings").update(row).eq("channel", "instagram");
  if (error !== null) throw unavailable("channel_settings update");
}

/** The first published property of each tier, by slug, so a second run reuses the properties of the first. */
async function pickProperties(db: Db): Promise<{ feature: string; campaign: string }> {
  const { data, error } = await db
    .from("properties")
    .select("id, campaign_tier")
    .eq("editorial_state", "published")
    .in("campaign_tier", ["Feature", "Campaign"])
    .order("slug");
  if (error !== null) throw unavailable("properties");
  const feature = data.find((row) => row.campaign_tier === "Feature");
  const campaign = data.find((row) => row.campaign_tier === "Campaign");
  if (feature === undefined || campaign === undefined) {
    throw new Error("BLOCKED: no published Feature and Campaign property (B2 seed)");
  }
  return { feature: feature.id, campaign: campaign.id };
}

/** A pending carousel that passes B9's approval guard; the next free revision of the property keeps the key unique. */
async function insertFixture(db: Db, propertyId: string): Promise<string> {
  const latest = await db
    .from("assets")
    .select("revision")
    .eq("property_id", propertyId)
    .eq("kind", "carousel")
    .order("revision", { ascending: false })
    .limit(1);
  if (latest.error !== null) throw unavailable("assets");
  const revision = (latest.data[0]?.revision ?? 0) + 1;
  const slide = (index: number) => ({
    media_key: `rehearsal/${propertyId}/r${String(revision)}/slide-${String(index)}.png`,
    w: 1080,
    h: 1350,
    bytes: 1,
    role: "slide",
    index,
  });
  const { data, error } = await db
    .from("assets")
    .insert({
      property_id: propertyId,
      kind: "carousel",
      revision,
      files: [slide(0), slide(1)],
      caption: "Approval rehearsal. Nothing is posted.",
      alt_text: "A placeholder slide of the approval rehearsal.",
      meta: { fixture: "rehearsal" },
    })
    .select("id")
    .single();
  if (error !== null) throw unavailable("assets insert");
  return data.id;
}

/** Prints the status of the asset's instagram row once the post step has written one; false when none appeared. */
async function awaitInstagramPost(db: Db, assetId: string): Promise<boolean> {
  for (let waited = 0; waited <= GIVE_UP_MS; waited += POLL_MS) {
    const { data, error } = await db
      .from("social_posts")
      .select("status")
      .eq("asset_id", assetId)
      .eq("channel", "instagram")
      .limit(1);
    if (error !== null) throw unavailable("social_posts");
    if (data[0] !== undefined) {
      console.log(`social_posts instagram ${data[0].status}`);
      return true;
    }
    await sleep(POLL_MS);
  }
  console.log(`social_posts instagram none after ${String(GIVE_UP_MS / 1000)} seconds`);
  return false;
}

async function rehearse(db: Db, now: Date): Promise<number> {
  const before = await readInstagram(db);
  try {
    await writeInstagram(db, {
      enabled: true,
      approval_mode: { ...before.approval_mode, Feature: "auto" },
      auto_after: new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10),
    });
    const properties = await pickProperties(db);
    const feature = await insertFixture(db, properties.feature);
    const campaign = await insertFixture(db, properties.campaign);
    let exit = 0;
    let approvedFeature = false;
    for (const [id, expected] of [
      [feature, "approved"],
      [campaign, "not_eligible"],
    ] as const) {
      const outcome = await maybeAutoApprove(db, id, now);
      console.log(
        outcome.status === "approved" ? `approved ${id}` : `not_eligible ${id} ${outcome.reason}`,
      );
      if (outcome.status !== expected) exit = 1;
      if (id === feature) approvedFeature = outcome.status === "approved";
    }
    if (approvedFeature && !(await awaitInstagramPost(db, feature))) exit = 1;
    return exit;
  } finally {
    await writeInstagram(db, before);
  }
}

export async function autoApproveRehearsalMain(
  argv: string[] = process.argv.slice(2),
  now: Date = new Date(),
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { target: { type: "string" } },
    strict: true,
  });
  assertDevTarget(values.target);
  guardEnv();
  await assertNotProduction();
  const { url, key } = devProject();
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const release = await holdDevLock();
  try {
    return await rehearse(db, now);
  } finally {
    await release();
  }
}

if (import.meta.main) await runScript(() => autoApproveRehearsalMain());
