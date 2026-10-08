import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { storageUnavailable } from "../../lib/media-store.ts";
import type { SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// B7 invariant 21 (a): an accepted request's photographs reach `staging/<property_id>/` in the private bucket
// `submissions` here, in the job runner, never inside an admin request (E2E-02, PERF-07). Each run lists the folder
// once and copies at most BATCH missing objects; the job comes back at once while any remain, then asks for the
// property's one render job.

const BUCKET = "submissions";
const BATCH = 20;

const stagedRowsSchema = z.array(z.object({ id: z.string(), staging_path: z.string() }));
const sourcesSchema = z.array(z.object({ id: z.string(), storage_path: z.string() }));
const listedSchema = z.array(z.object({ name: z.string() }));
// A copy onto an object that is already there (a rerun after a lost answer) counts as copied.
const duplicateSchema = z.union([
  z.object({ statusCode: z.literal("409") }),
  z.object({ code: z.literal("Duplicate") }),
]);
const priorSchema = z.object({ copied: z.number().int() }).nullable().catch(null);

const unavailable = (fn: string) =>
  new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);

async function stagedRows(db: Db, propertyId: string) {
  const { data, error } = await db
    .from("property_media")
    .select("id, staging_path")
    .eq("property_id", propertyId)
    .not("staging_path", "is", null);
  if (error !== null) throw unavailable("property_media");
  return stagedRowsSchema.parse(data);
}

async function listedNames(db: Db, propertyId: string): Promise<Set<string>> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list(`staging/${propertyId}`, { limit: 1000 });
  if (error !== null) throw storageUnavailable();
  return new Set(listedSchema.parse(data).map((entry) => `staging/${propertyId}/${entry.name}`));
}

async function sourcesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("submission_media")
    .select("id, storage_path")
    .in("id", ids);
  if (error !== null) throw unavailable("submission_media");
  return new Map(sourcesSchema.parse(data).map((row) => [row.id, row.storage_path]));
}

async function requestRender(db: Db, propertyId: string): Promise<string | null> {
  const { data, error } = await db.rpc("request_property_render", { p_property_id: propertyId });
  if (error !== null) throw unavailable("request_property_render");
  return z.string().nullable().parse(data);
}

export const copySubmissionMedia: SystemJobDefinition = {
  type: "copy_submission_media",
  sideEffect: "none",
  async run(ctx, _params, data) {
    const propertyId = data["property_id"];
    if (typeof propertyId !== "string") throw new NonRetryableError("invalid_property_id");
    const copiedBefore = priorSchema.parse(ctx.job.result)?.copied ?? 0;
    const listed = await listedNames(ctx.db, propertyId);
    const missing = (await stagedRows(ctx.db, propertyId)).filter(
      (row) => !listed.has(row.staging_path),
    );
    const sources =
      missing.length === 0
        ? new Map<string, string>()
        : await sourcesOf(
            ctx.db,
            missing.map((row) => row.id),
          );
    // A row with no request photograph behind it is an editor's upload, which the browser stores itself.
    const toCopy = missing.flatMap((row) => {
      const source = sources.get(row.id);
      return source === undefined ? [] : [{ source, target: row.staging_path }];
    });
    const store = ctx.db.storage.from(BUCKET);
    for (const { source, target } of toCopy.slice(0, BATCH)) {
      const { error } = await store.copy(source, target);
      if (error !== null && !duplicateSchema.safeParse(error).success) throw storageUnavailable();
    }
    const copied = copiedBefore + Math.min(toCopy.length, BATCH);
    if (toCopy.length > BATCH) {
      return { status: "retry_at", at: ctx.now, reason: "copy_more", result: { copied } };
    }
    return {
      status: "done",
      result: { copied, render_job_id: await requestRender(ctx.db, propertyId) },
    };
  },
};
