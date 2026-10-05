import { z } from "zod";
import type { Json, Tables } from "../../db/index.ts";
import { stepSchema } from "../../domain/automation.ts";
import { eventPayloadSchemas } from "../../domain/events.ts";
import { getStep } from "../jobs/steps/index.ts";
import type { JsonObject } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { logLine } from "../lib/log.ts";
import { planEvent, type PlanRecipe } from "./plan.ts";

// Real fan-out (B8b invariants 3 to 5): read the event and its recipe, plan with `planEvent`, the same pure function
// dry-run calls, and hand the jobs to `fanout_insert_jobs`, the one write path. It locks the event, inserts by
// idempotency key and sets `processed_at` last, so a replan after a crash or an overlapping sweep inserts nothing.

type EventRow = Pick<Tables<"events">, "id" | "type" | "payload" | "at">;

const HOUR_MS = 3_600_000;
const recipeSteps = z.array(stepSchema);
const payloadSchemas: Readonly<Record<string, z.ZodTypeAny>> = eventPayloadSchemas;

function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);
}

const errorCode = (failure: unknown): string =>
  failure instanceof AppError ? failure.code : "server";

/** Whether a payload parses with its event type's schema; a type with no schema never does. */
export const payloadIsValid = (type: string, payload: Json): boolean =>
  payloadSchemas[type]?.safeParse(payload).success === true;

const isObject = (value: Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The recipe of a trigger as the planner takes it; shared with dry-run, so both read it the same way. */
export async function readRecipe(db: Db, trigger: string): Promise<PlanRecipe> {
  const { data, error } = await db
    .from("automation_recipes")
    .select("id, trigger, enabled, steps")
    .eq("trigger", trigger);
  if (error !== null) throw unavailable("automation_recipes");
  const row = data[0];
  if (row === undefined) {
    throw new AppError("unknown_trigger", undefined, `No recipe for ${trigger}.`);
  }
  const steps = recipeSteps.safeParse(row.steps);
  if (!steps.success) {
    throw new AppError(
      "validation",
      undefined,
      "The recipe's steps are not valid.",
      steps.error.issues,
    );
  }
  return { id: row.id, trigger: row.trigger, enabled: row.enabled, steps: steps.data };
}

async function fanout(db: Db, event: EventRow): Promise<number> {
  const recipe = await readRecipe(db, event.type);
  // An invalid payload is still planned: a step that needs a missing field fails on its first run (invariant 9).
  if (!payloadIsValid(event.type, event.payload)) {
    logLine("warn", "fanout_payload_invalid", { eventId: event.id });
  }
  const payload = isObject(event.payload) ? event.payload : {};
  const plan = planEvent(recipe, { id: event.id, payload }, { registry: getStep });
  const { data, error } = await db.rpc("fanout_insert_jobs", {
    p_event_id: event.id,
    // Spread into plain objects: an interface has no index signature, so it is not assignable to `Json`.
    p_jobs: plan.planned.map((job) => ({ ...job, payload: { ...job.payload } })),
  });
  if (error !== null) throw unavailable("fanout_insert_jobs");
  return data;
}

/** One event, best effort after the commit that wrote it; returns the jobs inserted. */
export async function fanoutEvent(db: Db, eventId: string): Promise<number> {
  const { data, error } = await db.from("events").select("id, type, payload, at").eq("id", eventId);
  if (error !== null) throw unavailable("events");
  const event = data[0];
  if (event === undefined) throw new AppError("not_found", undefined, "The event does not exist.");
  return fanout(db, event);
}

/**
 * A failed event waits for its `next_at` (JOB-07), so it is retried at most hourly and cannot fill the sweep. One
 * still failing an hour after it happened alerts the admins once: the key makes it one job per event.
 */
async function recordFailure(db: Db, event: EventRow, failure: unknown): Promise<void> {
  const code = errorCode(failure);
  logLine("warn", "fanout_failed", { eventId: event.id, code });
  const message = failure instanceof Error ? failure.message : code;
  const { error } = await db.rpc("record_fanout_failure", {
    p_event_id: event.id,
    p_error: message,
  });
  if (error !== null) throw unavailable("record_fanout_failure");
  if (Date.now() - Date.parse(event.at) <= HOUR_MS) return;
  await enqueueJob(db, {
    type: "notify_admin",
    idempotencyKey: `fanout_failed:${event.id}`,
    params: { headline: "Event could not be planned" },
    data: { summary: `${event.type} ${event.id}: ${code}`, link_path: "/admin/jobs" },
    maxAttempts: 12,
  });
}

/** The runner's sweep of the oldest unprocessed events; one bad event never blocks the others. */
export async function fanoutPendingEvents(db: Db, limit: number): Promise<number> {
  const { data, error } = await db.rpc("fanout_pending_events", { p_limit: limit });
  if (error !== null) throw unavailable("fanout_pending_events");
  let inserted = 0;
  for (const event of data) {
    try {
      inserted += await fanout(db, event);
    } catch (failure) {
      // A failure that cannot be recorded is logged and the sweep goes on, so it never ends the runner's tick.
      await recordFailure(db, event, failure).catch((unrecorded: unknown) => {
        logLine("error", "fanout_failure_unrecorded", {
          eventId: event.id,
          code: errorCode(unrecorded),
        });
      });
    }
  }
  return inserted;
}
