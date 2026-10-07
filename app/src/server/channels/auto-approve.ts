import { z } from "zod";
import { channelSettingsSchema } from "../../domain/automation.ts";
import { tiers } from "../../domain/events.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import { mayApprove } from "./approval.ts";
import { targetsFor } from "./index.ts";

// Automatic approval (B10 invariants 4 and 4a). The system approves only a complete, pending Feature-mode asset whose
// every enabled target channel is in `auto`; B9's approve_asset stays the only writer of the approval and the only
// emitter of asset.approved (G20), and this module emits nothing: it fans the returned event out after the commit.

type Reason = "not_pending" | "incomplete" | "lint_failed" | "no_target" | "tier_manual";

export type AutoApproval =
  { status: "approved"; eventId: string } | { status: "not_eligible"; reason: Reason };

const rowSchema = channelSettingsSchema
  .pick({ enabled: true, approval_mode: true, auto_after: true })
  .extend({ channel: z.string() });
const lintSchema = z.object({ caption_lint: z.string().optional() }).passthrough();
const multiImageSchema = z
  .object({ multi_image: z.boolean().nullable().optional() })
  .passthrough()
  .nullable();

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The database did not answer (${what}).`);
const blank = (text: string | null) => text === null || text.trim() === "";

/** Approves `assetId` when every rule of invariant 4a holds; otherwise names the first rule that does not. */
export async function maybeAutoApprove(db: Db, assetId: string, now: Date): Promise<AutoApproval> {
  const assets = await db
    .from("assets")
    .select("status, kind, files, caption, alt_text, meta, property_id")
    .eq("id", assetId)
    .limit(1);
  if (assets.error !== null) throw unavailable("assets");
  const asset = assets.data[0];
  if (asset === undefined) throw new AppError("not_found", undefined, "The asset does not exist.");
  if (asset.status !== "pending") return { status: "not_eligible", reason: "not_pending" };
  // B9's assets_approve_guard asks the same of a cover, carousel or story.
  const files = Array.isArray(asset.files) ? asset.files : [];
  if (files.length === 0 || blank(asset.caption) || blank(asset.alt_text)) {
    return { status: "not_eligible", reason: "incomplete" };
  }
  if (lintSchema.safeParse(asset.meta).data?.caption_lint === "failed") {
    return { status: "not_eligible", reason: "lint_failed" };
  }

  const [properties, settings, channels] = await Promise.all([
    db.from("properties").select("campaign_tier").eq("id", asset.property_id).limit(1),
    db.from("settings").select("value").eq("key", "linkedin"),
    db.from("channel_settings").select("channel, enabled, approval_mode, auto_after"),
  ]);
  if (properties.error !== null) throw unavailable("properties");
  if (settings.error !== null) throw unavailable("settings");
  if (channels.error !== null) throw unavailable("channel_settings");
  const multiImage =
    multiImageSchema.safeParse(settings.data[0]?.value ?? null).data?.multi_image === true;
  const targets = targetsFor(asset.kind, { linkedin: { multi_image: multiImage } });
  const rows = channels.data
    .map((row) => rowSchema.parse(row))
    .filter((row) => row.enabled && targets.some((target) => target === row.channel));
  if (rows.length === 0) return { status: "not_eligible", reason: "no_target" };
  const tier = tiers.find((name) => name === properties.data[0]?.campaign_tier);
  const today = now.toISOString().slice(0, 10);
  if (tier === undefined || !mayApprove({ kind: "agent" }, tier, rows, today)) {
    return { status: "not_eligible", reason: "tier_manual" };
  }

  // Every row is auto by now, so the latest `auto_after` is the day automatic posting began for all of them.
  const autoAfter =
    rows
      .map((row) => row.auto_after ?? "")
      .sort()
      .at(-1) ?? null;
  const { data: eventId, error } = await db.rpc("auto_approve_asset", {
    p_asset_id: assetId,
    p_evidence: { tier, channels: rows.map((row) => row.channel), auto_after: autoAfter },
  });
  if (error !== null) throw unavailable("auto_approve_asset");
  try {
    // fanout.ts reads the step registry, which holds the render steps that call this module: a static import closes
    // that circle and leaves the registry half built (G-1000), so the fan-out is loaded when it is needed.
    const { fanoutEvent } = await import("../automation/fanout.ts");
    await fanoutEvent(db, eventId);
  } catch (failure) {
    // Best effort, as B9's approveAsset: the runner's sweep plans an event that was not fanned out here.
    logLine("warn", "fanout_failed", {
      eventId,
      code: failure instanceof AppError ? failure.code : "server",
    });
  }
  return { status: "approved", eventId };
}
