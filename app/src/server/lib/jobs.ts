import type { Json } from "../../db/index.ts";
import { jobEntityKeys } from "../../domain/job-entities.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

// Jobs that have no event (health, prune, manual forward). The payload is the envelope `{ params, data }`
// the runner reads (B8 Contract); `maxAttempts` absent keeps the SQL default of 5, and a type that calls an
// outside provider passes the 12 its registry entry declares (invariant 4, DL-10).

type JsonObject = { [key: string]: Json | undefined };

function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);
}

/** The new job id, or null when the key already exists (invariant 1). */
export async function enqueueJob(
  db: Db,
  input: {
    type: string;
    idempotencyKey: string;
    params?: JsonObject;
    data?: JsonObject;
    heavy?: boolean;
    runAfter?: Date;
    maxAttempts?: number;
  },
): Promise<string | null> {
  const { data, error } = await db.rpc("enqueue_job", {
    p_type: input.type,
    p_payload: { params: input.params ?? {}, data: input.data ?? {} },
    p_idempotency_key: input.idempotencyKey,
    p_heavy: input.heavy ?? false,
    ...(input.runAfter === undefined ? {} : { p_run_after: input.runAfter.toISOString() }),
    ...(input.maxAttempts === undefined ? {} : { p_max_attempts: input.maxAttempts }),
  });
  if (error !== null) throw unavailable("enqueue_job");
  return data;
}

/** A manual system job keyed `<type>:<entity_id>:<n>`; null back is a failure the caller raises (DB-09). */
export async function enqueueManualJob(
  db: Db,
  input: { type: string; entityId: string; data: JsonObject; maxAttempts?: number },
): Promise<string | null> {
  const { data, error } = await db.rpc("enqueue_job_manual", {
    p_type: input.type,
    p_entity_id: input.entityId,
    p_payload: { params: {}, data: input.data },
    ...(input.maxAttempts === undefined ? {} : { p_max_attempts: input.maxAttempts }),
  });
  if (error !== null) throw unavailable("enqueue_job_manual");
  return data;
}

// The keys live in `src/domain/job-entities.ts`, which screen 16's browser code also reads.
export { jobEntityKeys };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one rule for "the jobs of one entity" (G64): the PostgREST `or` text over the event path (the computed
 * field `job_event_entity_id`), each uuid key of `payload.data`, and the key of a manual system job.
 */
export function entityJobsFilter(entityId: string): string {
  if (!UUID.test(entityId)) {
    throw new AppError("validation", undefined, "The entity id is not a uuid.");
  }
  return [
    `job_event_entity_id.eq.${entityId}`,
    ...jobEntityKeys.map((key) => `payload->data->>${key}.eq.${entityId}`),
    `idempotency_key.like.*:${entityId}:*`,
  ].join(",");
}
