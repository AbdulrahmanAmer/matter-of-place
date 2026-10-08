import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { deleteObjects, mediaUrl } from "../../lib/media-store.ts";
import { readVar } from "../../lib/runtime-env.ts";
import { purgeUrls } from "../steps/purge-cache.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// E2E-01, ruling H33 (6): a rights takedown removes every file of the property from the bucket `media`, then purges
// their public addresses and marks the property's live posts for withdrawal by hand. B7's `unpublish_property` enqueues
// it when `p_takedown` is true. The delete runs once: its time is stored in `result`, and the next run only purges.

const keysSchema = z.array(z.string());
const deletedSchema = z
  .object({ deleted_at: z.string(), deleted: z.number().int() })
  .nullable()
  .catch(null);

const unavailable = (fn: string) =>
  new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);

async function mediaKeys(db: Db, propertyId: string): Promise<string[]> {
  const { data, error } = await db.rpc("takedown_media_keys", { p_property_id: propertyId });
  if (error !== null) throw unavailable("takedown_media_keys");
  return keysSchema.parse(data);
}

async function markPosts(db: Db, propertyId: string): Promise<number> {
  const { data, error } = await db.rpc("takedown_mark_posts", { p_property_id: propertyId });
  if (error !== null) throw unavailable("takedown_mark_posts");
  return z.number().int().parse(data);
}

/** Purges `<MEDIA_PUBLIC_BASE>/<key>` for each key; without the base there is no public address to purge. */
async function purge(ctx: StepContext, keys: readonly string[]) {
  if (readVar("MEDIA_PUBLIC_BASE") === undefined) {
    return { purged: 0, purge_skipped: "no_media_public_base" };
  }
  const urls = keys.map((key) => mediaUrl(key, { absolute: true }));
  const { purged, skipped } = await purgeUrls(urls, ctx);
  return skipped === undefined ? { purged } : { purged, purge_skipped: skipped };
}

export const takedownMedia: SystemJobDefinition = {
  type: "takedown_media",
  sideEffect: "sql_guard",
  maxAttempts: 12,
  async run(ctx, _params, data) {
    const propertyId = data["property_id"];
    if (typeof propertyId !== "string") throw new NonRetryableError("invalid_property_id");
    const keys = await mediaKeys(ctx.db, propertyId);
    const done = deletedSchema.parse(ctx.job.result);
    if (done === null) {
      const { deleted } = await deleteObjects("media", keys);
      return {
        status: "retry_at",
        at: ctx.now,
        reason: "takedown_purge",
        result: { deleted_at: ctx.now.toISOString(), deleted },
      };
    }
    const purged = await purge(ctx, keys);
    const postsMarked = await markPosts(ctx.db, propertyId);
    return { status: "done", result: { ...done, ...purged, posts_marked: postsMarked } };
  },
};
