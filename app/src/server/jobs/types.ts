import type { z } from "zod";
import type { Json } from "../../db/index.ts";
import type { Db } from "../lib/db.ts";
import type { logLine } from "../lib/log.ts";

export type JsonObject = { [key: string]: Json | undefined };

/** The variables of the process that runs a step: `Deno.env.toObject()` in the job runner. */
export type RunnerEnv = Record<string, string | undefined>;

/** One Sentry event through the runner's client (INT-04). */
export type Reporter = (
  error: unknown,
  options: { fingerprint: string[]; level?: "error" | "warning" },
) => Promise<void>;

/** `jobs.payload`: the step's parameters, snapshotted when the job was made, and the event or system input. */
export interface JobPayload {
  params: Json;
  data: JsonObject;
}

export interface StepContext {
  db: Db;
  env: RunnerEnv;
  log: typeof logLine;
  /** Taken once when the job is claimed; a step reads it and never calls the clock (R29). */
  now: Date;
  /** Every outside `fetch` passes it (JOB-02). */
  signal: AbortSignal;
  report: Reporter;
  /** The claimed row: `claim` is the token `claim_job` wrote into `locked_by`, `result` what the last attempt stored. */
  job: {
    id: string;
    type: string;
    attempts: number;
    claim: string;
    result: Json | null;
    eventId: string | null;
  };
}

/** The runner writes `result` into `jobs.result` in every case; a step never updates `jobs` itself. */
export type StepResult =
  | { status: "done"; result?: Json | undefined }
  | { status: "retry_at"; at: Date; reason: string; result?: Json | undefined }
  | { status: "dispatched"; result?: Json | undefined };

/** The mechanism that keeps a rerun from repeating an outside effect (R28); `none` means no outside effect. */
export type SideEffect = "none" | "idempotency_key" | "begin_row" | "remote_lookup" | "sql_guard";

export interface StepDefinition<P = unknown> {
  type: string;
  heavy: boolean;
  /** The third execution class (ruling H34 (2)): registered for the planner, never claimed by the job runner. */
  local?: boolean;
  paramsSchema: z.ZodType<P>;
  maxAttempts?: number;
  timeoutMs?: number;
  run(ctx: StepContext, params: P, data: JsonObject): Promise<StepResult>;
  /** Heavy steps: runs in the Worker when the render callback arrives. */
  onResult?(ctx: StepContext, job: StepContext["job"], result: Json): Promise<void>;
}

export interface SystemJobDefinition {
  type: string;
  sideEffect: SideEffect;
  maxAttempts?: number;
  timeoutMs?: number;
  run(ctx: StepContext, params: Json, data: JsonObject): Promise<StepResult>;
}

/** A failure that no retry can fix: the job goes `dead` after this one attempt. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
