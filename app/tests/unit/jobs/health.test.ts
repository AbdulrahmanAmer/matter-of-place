// B8 step 8: the daily health job (F17, INT-04, SEC-11, PERF-09, JOB-10, ruling H34 (6)). The database is B3's fakeDb
// with the one health_counts answer each case sets; no provider credential is set, so the provider checks skip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db";
import { health, type HealthCounts } from "../../../src/server/jobs/system/health";
import type { RunnerEnv, StepContext, StepResult } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { captureException } from "../../../src/server/lib/sentry";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T13:00:00.000Z");
const HOUR_MS = 3600 * 1000;

const quiet: HealthCounts = {
  dead_jobs_24h: 0,
  stale_queue: 0,
  retention_stalled: [],
  long_waits: 0,
  local_oldest_age_s: null,
  backup: null,
};

interface Setup {
  counts?: Partial<HealthCounts>;
  cronFailures?: number;
}

function setup({ counts = {}, cronFailures = 0 }: Setup = {}): FakeDb {
  const db = fakeDb({
    rpc: {
      health_counts: () => ({ ...quiet, ...counts }),
      health_cron_failures: () => cronFailures,
      emit_event: () => "5b0c7c4e-0000-4000-8000-000000000009",
    },
  });
  // The provider checks read settings.linkedin with one filtered select; B3's fakeDb answers only a bare select.
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
    },
  });
}

const report = vi.fn<StepContext["report"]>(() => Promise.resolve());

function context(
  db: FakeDb,
  env: RunnerEnv = {},
  reporter: StepContext["report"] = report,
): StepContext {
  return {
    db,
    env,
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: reporter,
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "health",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

const resultSchema = z.object({
  checks: z.array(z.object({ name: z.string(), status: z.string(), message: z.string() })),
});

function checksOf(result: StepResult): z.infer<typeof resultSchema>["checks"] {
  if (result.status !== "done") throw new Error(`health ended ${result.status}`);
  return resultSchema.parse(result.result).checks;
}

const statusOf = (result: StepResult, name: string): string | undefined =>
  checksOf(result).find((check) => check.name === name)?.status;

const emitted = (db: FakeDb): unknown[] =>
  db.calls
    .filter((call) => call.kind === "rpc" && call.name === "emit_event")
    .map((call) => call.args[0]);

async function run(setupWith: Setup = {}, params: Json = {}, env: RunnerEnv = {}) {
  const db = setup(setupWith);
  const result = await health.run(context(db, env), params, {});
  return { db, result };
}

afterEach(() => {
  report.mockClear();
  vi.unstubAllGlobals();
});

describe("health job", () => {
  it("a forced failing check emits exactly one health.failed and the job ends done with every check", async () => {
    const { db, result } = await run({}, { force_fail: "stale_queue" });
    expect(result.status).toBe("done");
    expect(checksOf(result).map((check) => check.name)).toEqual([
      "captions_waiting",
      "dead_jobs_24h",
      "stale_queue",
      "cron_failures",
      "retention_stalled",
      "long_waits",
      "backup_fresh",
      "github_dispatch",
      "resend_domain",
      "linkedin_version",
    ]);
    expect(emitted(db)).toEqual([
      {
        p_type: "health.failed",
        p_entity: "system",
        p_payload: {
          date: "2026-10-04",
          failed: [{ check: "stale_queue", message: "forced by params.force_fail" }],
          summary: "1 checks failed: stale_queue",
          link_path: "/admin/jobs",
        },
      },
    ]);
  });

  it("emits nothing when every check is ok, warn or skip", async () => {
    const { db, result } = await run({ counts: { long_waits: 2 } });
    expect(checksOf(result).every((check) => check.status !== "fail")).toBe(true);
    expect(emitted(db)).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("params.force_fail fails the named check and leaves the others as they are", async () => {
    const { result } = await run({}, { force_fail: "backup_fresh" });
    expect(statusOf(result, "backup_fresh")).toBe("fail");
    expect(statusOf(result, "dead_jobs_24h")).toBe("ok");
  });

  it("reports each failed check once to Sentry with its fingerprint", async () => {
    const { result } = await run({ counts: { dead_jobs_24h: 1, stale_queue: 2 } });
    expect(statusOf(result, "dead_jobs_24h")).toBe("fail");
    expect(report.mock.calls.map(([error, options]) => [String(error), options])).toEqual([
      [
        "Error: HealthCheckFailed: dead_jobs_24h",
        { fingerprint: ["health", "dead_jobs_24h"], level: "error" },
      ],
      [
        "Error: HealthCheckFailed: stale_queue",
        { fingerprint: ["health", "stale_queue"], level: "error" },
      ],
    ]);
  });

  it("with the Resend fetch failing, a failed check still sends exactly one Sentry envelope (INT-04)", async () => {
    const fetchSpy = vi.fn((input: string, _init?: RequestInit) =>
      input.startsWith("https://api.resend.com")
        ? Promise.reject(new Error("resend down"))
        : Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const sentry: StepContext["report"] = (error, { fingerprint, level }) =>
      captureException(error, {
        dsn: "https://publickey@o1.ingest.sentry.io/42",
        requestId: "health-test",
        route: "job-runner",
        side: "job-runner",
        env: "preview",
        release: "test",
        fingerprint,
        ...(level && { level }),
      });
    const db = setup();
    const result = await health.run(
      context(db, { RESEND_API_KEY: "re_test" }, sentry),
      { force_fail: "cron_failures" },
      {},
    );
    const envelopes = fetchSpy.mock.calls
      .map(([input]) => input)
      .filter((url) => url === "https://o1.ingest.sentry.io/api/42/envelope/");
    expect(statusOf(result, "resend_domain")).toBe("warn");
    expect(envelopes).toHaveLength(1);
    const body = fetchSpy.mock.calls.find(([input]) => input.includes("/envelope/"));
    expect(JSON.stringify(body)).toContain('\\"fingerprint\\":[\\"health\\",\\"cron_failures\\"]');
  });

  it("maps dead jobs, a stale queue, cron failures and a stalled policy to fail", async () => {
    const { result } = await run({
      counts: { dead_jobs_24h: 1, stale_queue: 1, retention_stalled: ["rate_limits"] },
      cronFailures: 1,
    });
    expect(
      ["dead_jobs_24h", "stale_queue", "cron_failures", "retention_stalled"].map((name) =>
        statusOf(result, name),
      ),
    ).toEqual(["fail", "fail", "fail", "fail"]);
  });

  it("health_cron_failures above 0 is fail and 0 is ok", async () => {
    const failing = await run({ cronFailures: 1 });
    const clear = await run({ cronFailures: 0 });
    expect([
      statusOf(failing.result, "cron_failures"),
      statusOf(clear.result, "cron_failures"),
    ]).toEqual(["fail", "ok"]);
  });

  it("long_waits above 0 is warn", async () => {
    const { result } = await run({ counts: { long_waits: 1 } });
    expect(statusOf(result, "long_waits")).toBe("warn");
  });
});

describe("backup_fresh", () => {
  const backupAt = (hours: number) => ({
    enabled: true,
    last_run_at: new Date(NOW.getTime() - hours * HOUR_MS).toISOString(),
  });

  it("is fail with the row enabled and the last run 37 hours old", async () => {
    const { result } = await run({ counts: { backup: backupAt(37) } });
    expect(statusOf(result, "backup_fresh")).toBe("fail");
  });

  it("is ok at 35 hours", async () => {
    const { result } = await run({ counts: { backup: backupAt(35) } });
    expect(statusOf(result, "backup_fresh")).toBe("ok");
  });

  it("is fail with the row enabled and no run yet", async () => {
    const { result } = await run({ counts: { backup: { enabled: true, last_run_at: null } } });
    expect(statusOf(result, "backup_fresh")).toBe("fail");
  });

  it("is ok while backup is null", async () => {
    const { result } = await run({ counts: { backup: null } });
    expect(statusOf(result, "backup_fresh")).toBe("ok");
  });

  it("is warn with the row disabled while MOP_ENV is production, ok outside it", async () => {
    const off = { backup: { enabled: false, last_run_at: null } };
    const production = await run({ counts: off }, {}, { MOP_ENV: "production" });
    const preview = await run({ counts: off }, {}, { MOP_ENV: "preview" });
    expect([
      statusOf(production.result, "backup_fresh"),
      statusOf(preview.result, "backup_fresh"),
    ]).toEqual(["warn", "ok"]);
  });
});

describe("captions_waiting", () => {
  it("is fail at 25 hours, with one health.failed naming it", async () => {
    const { db, result } = await run({ counts: { local_oldest_age_s: 25 * 3600 } });
    expect(checksOf(result).find((check) => check.name === "captions_waiting")).toEqual({
      name: "captions_waiting",
      status: "fail",
      message:
        "caption job waiting 25 hours: run bun run captions on the laptop or type the captions by hand",
    });
    expect(JSON.stringify(emitted(db))).toContain('"summary":"1 checks failed: captions_waiting"');
    expect(emitted(db)).toHaveLength(1);
  });

  it("is ok at 23 hours and while no caption job waits", async () => {
    const waiting = await run({ counts: { local_oldest_age_s: 23 * 3600 } });
    const none = await run({ counts: { local_oldest_age_s: null } });
    expect([
      statusOf(waiting.result, "captions_waiting"),
      statusOf(none.result, "captions_waiting"),
    ]).toEqual(["ok", "ok"]);
  });
});
