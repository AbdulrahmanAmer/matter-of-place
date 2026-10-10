import { z } from "zod";
import type { Json } from "../../../db/index.ts";
import { gaugeStatus, P009_LIMITS } from "../../audit/gauges.ts";
import { readUsage } from "../../audit/service.ts";
import { AppError } from "../../lib/errors.ts";
import { emitEvent } from "../../lib/events.ts";
import { readState, resetPublicStateMemo } from "../../public/state.ts";
import { siteReadiness } from "../../settings/readiness.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";
import { providerChecks } from "./health/providers.ts";

// The daily health job (architecture 13, F17): every check runs, the job stores what each one said, and a failed check
// becomes one `health.failed` event (B8b's notify_admin_health recipe mails it) and one Sentry event per check, so a
// failure reaches the owner while Resend cannot (INT-04). It never throws for a failed check, so the alert is not
// retried. A stopped runner is ops_health's to catch (invariant 9), not this job's.

type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckOutcome {
  status: CheckStatus;
  message: string;
}

const countsSchema = z.object({
  dead_jobs_24h: z.number(),
  stale_queue: z.number(),
  retention_stalled: z.array(z.string()),
  long_waits: z.number(),
  local_oldest_age_s: z.number().nullable(),
  backup: z.object({ enabled: z.boolean(), last_run_at: z.string().nullable() }).nullable(),
});
export type HealthCounts = z.infer<typeof countsSchema>;

// The numbers of `audit_usage()` that fill the gauge lines our own database can measure (B14 invariant 4).
const usageSchema = z.object({
  db_bytes: z.number(),
  storage_bytes: z.number(),
  email_sent_today: z.number(),
  email_sent_month: z.number(),
  subscribers_confirmed: z.number(),
});

/** A check's view of the run: the step context plus the one `health_counts` read, made on first use. */
export interface HealthContext extends StepContext {
  counts(): Promise<HealthCounts>;
}

export interface HealthCheck {
  name: string;
  run(ctx: HealthContext): Promise<CheckOutcome>;
}

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;
const BACKUP_FAIL_MS = 36 * HOUR_S * 1000;

const ok = (message: string): CheckOutcome => ({ status: "ok", message });
const fail = (message: string): CheckOutcome => ({ status: "fail", message });

/** `fail` with `message` when `count` is above 0. */
function failWhenAny(count: number, message: string): CheckOutcome {
  return count > 0 ? fail(`${String(count)} ${message}`) : ok("none");
}

async function readCounts(ctx: StepContext): Promise<HealthCounts> {
  const { data, error } = await ctx.db.rpc("health_counts", { p_now: ctx.now.toISOString() });
  if (error !== null)
    throw new AppError("unavailable", undefined, "The job system did not answer (health_counts).");
  return countsSchema.parse(data);
}

// Later slices append one entry each (B14 added usage_gauges); the provider checks come last.
export const healthChecks: readonly HealthCheck[] = [
  {
    // Ruling H34 (6): a caption job waits for the laptop runner, and a day of waiting needs a person.
    name: "captions_waiting",
    async run(ctx) {
      const age = (await ctx.counts()).local_oldest_age_s;
      if (age === null || age < DAY_S) return ok("no caption job waiting a day");
      return fail(
        `caption job waiting ${String(Math.floor(age / HOUR_S))} hours: run bun run captions on the laptop or type the captions by hand`,
      );
    },
  },
  {
    name: "dead_jobs_24h",
    async run(ctx) {
      return failWhenAny((await ctx.counts()).dead_jobs_24h, "jobs went dead in the last 24 hours");
    },
  },
  {
    name: "stale_queue",
    async run(ctx) {
      return failWhenAny(
        (await ctx.counts()).stale_queue,
        "queued jobs are more than 15 minutes overdue",
      );
    },
  },
  {
    // pg_cron's own failures; a runner that answers 401 or 500 is ops_health's (DO-03).
    name: "cron_failures",
    async run(ctx) {
      const since = new Date(ctx.now.getTime() - DAY_S * 1000);
      const { data, error } = await ctx.db.rpc("health_cron_failures", {
        p_since: since.toISOString(),
      });
      if (error !== null) {
        throw new AppError(
          "unavailable",
          undefined,
          "The job system did not answer (health_cron_failures).",
        );
      }
      return failWhenAny(data, "pg_cron runs failed in the last 24 hours");
    },
  },
  {
    name: "retention_stalled",
    async run(ctx) {
      const stalled = (await ctx.counts()).retention_stalled;
      return stalled.length > 0
        ? fail(`not run for 2 days or rows left: ${stalled.join(", ")}`)
        : ok("none");
    },
  },
  {
    // JOB-10: a wait with no deadline shows on the daily report.
    name: "long_waits",
    async run(ctx) {
      const waits = (await ctx.counts()).long_waits;
      return waits > 0
        ? { status: "warn", message: `${String(waits)} jobs have waited more than 7 days` }
        : ok("none");
    },
  },
  {
    // SEC-11, PERF-09: B8b's backup row, null until that table exists.
    name: "backup_fresh",
    async run(ctx) {
      const { backup } = await ctx.counts();
      if (backup === null) return ok("no backup schedule yet");
      if (!backup.enabled) {
        return ctx.env["MOP_ENV"] === "production"
          ? { status: "warn", message: "the backup schedule is off" }
          : ok("the backup schedule is off outside production");
      }
      const last = backup.last_run_at === null ? null : Date.parse(backup.last_run_at);
      if (last === null || ctx.now.getTime() - last > BACKUP_FAIL_MS) {
        return fail("no backup in the last 36 hours");
      }
      return ok("backup within 36 hours");
    },
  },
  {
    // B16: the owner's identity lines (entity, address, contact) are read from `settings.site` by the footer, the legal
    // pages and every email. Missing lines are expected in development and preview; anywhere else, or with `MOP_ENV`
    // unset, they fail the day. The shared public state serves its last good copy when the database does not answer
    // (B3 invariant 16), so the memo is dropped first and a stale answer is a failure, not a pass.
    name: "site_identity",
    async run(ctx) {
      resetPublicStateMemo();
      let stale: boolean;
      try {
        stale = (await readState(ctx.db)).stale;
      } catch (error) {
        return fail(error instanceof AppError ? error.code : "unavailable");
      }
      if (stale) return fail("public_state_stale");
      const missing = await siteReadiness(ctx.db);
      if (missing.length === 0) return ok("every required identity field is set");
      const lenient = ctx.env["MOP_ENV"] === "development" || ctx.env["MOP_ENV"] === "preview";
      return {
        status: lenient ? "warn" : "fail",
        message: `settings.site is missing: ${missing.join(", ")}`,
      };
    },
  },
  {
    // B14 GS-06: the vendors mail at thresholds of their own choosing, so this is the 70 percent line (invariant 7).
    name: "usage_gauges",
    async run(ctx) {
      const usage = usageSchema.parse(await readUsage(ctx.db));
      const used: Record<string, number> = {
        db_bytes: usage.db_bytes,
        storage_bytes: usage.storage_bytes,
        email_sent_today: usage.email_sent_today,
        email_sent_month: usage.email_sent_month,
        resend_contacts: usage.subscribers_confirmed,
      };
      const reached = P009_LIMITS.flatMap((gauge) => {
        const value = used[gauge.line];
        if (value === undefined) return [];
        const { percent, status } = gaugeStatus(gauge, value);
        return status === "DECISION" || status === "LIMIT"
          ? [`${gauge.line} at ${String(percent)} percent of ${String(gauge.limit)} ${gauge.unit}`]
          : [];
      });
      return reached.length > 0 ? fail(reached.join("; ")) : ok("every line is under 70 percent");
    },
  },
  ...providerChecks,
];

function forcedFail(params: Json): string | undefined {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
  const name = params["force_fail"];
  return typeof name === "string" ? name : undefined;
}

function once<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= read());
}

export const health: SystemJobDefinition = {
  type: "health",
  sideEffect: "none",
  timeoutMs: 40_000,
  async run(ctx, params) {
    // H1's drill: params.force_fail names a check that then fails without running.
    const forced = forcedFail(params);
    const hctx: HealthContext = { ...ctx, counts: once(() => readCounts(ctx)) };
    const checks: { name: string; status: CheckStatus; message: string }[] = [];
    for (const check of healthChecks) {
      const outcome =
        check.name === forced ? fail("forced by params.force_fail") : await check.run(hctx);
      checks.push({ name: check.name, ...outcome });
    }
    const failed = checks.filter((check) => check.status === "fail");
    for (const check of failed) {
      await ctx.report(new Error(`HealthCheckFailed: ${check.name}`), {
        fingerprint: ["health", check.name],
        level: "error",
      });
    }
    if (failed.length > 0) {
      await emitEvent(ctx.db, {
        type: "health.failed",
        entity: "system",
        entityId: null,
        payload: {
          date: ctx.now.toISOString().slice(0, 10),
          failed: failed.map((check) => ({ check: check.name, message: check.message })),
          summary: `${String(failed.length)} checks failed: ${failed.map((check) => check.name).join(", ")}`,
          link_path: "/admin/jobs",
        },
      });
    }
    return { status: "done", result: { checks } };
  },
};
