import "../../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { Tables } from "../../../src/db";
import {
  getHealth,
  getKpis,
  getUsage,
  listNotFound,
  recordAuditRun,
} from "../../../src/server/audit/service";
import { getScheduleSetting, putScheduleSettings } from "../../../src/server/automation/service";
import { retryJob } from "../../../src/server/jobs/service";
import { collectWeeklyKpis } from "../../../src/server/kpi/collect";
import type { KpiWeek } from "../../../src/server/kpi/definitions";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { ForbiddenError } from "../../../src/server/lib/authz";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

// B14 step 4, invariant 3: the auditor's agent key (role commercial, scopes audit and automation) reads its four
// actions and its schedule row, records a run, and is refused every other write.

const AUDITOR: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  kind: "agent",
  roles: ["commercial"],
  scopes: ["audit", "automation"],
  requestId: "req-audit-1",
};
const EDITOR: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000e1",
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
  requestId: "req-editor-1",
};
const NOW = new Date("2026-10-10T12:00:00Z");
const RUN_AT = "2026-10-10T12:00:01.123456+00:00";

const week = (weekStart: string): KpiWeek => ({
  week_start: weekStart,
  week_end: weekStart,
  submissions_received: 3,
  decisions: { accepted: 1, declined: 1 },
  time_to_decision_hours: 20,
  invoices: { issued: 1, issued_amount: 2500, paid: 0, paid_amount: 0 },
  properties_published: 2,
  posts_by_channel: { linkedin: 1 },
  newsletter: { confirmed: 2, unsubscribed: 0, net: 2, total_confirmed: 40 },
  inquiries: { received: 5, published_properties: 2, top: [] },
});

const auditRow: Tables<"schedule_settings"> = {
  id: "00000000-0000-4000-8000-0000000000s1",
  key: "audit",
  cron: "0 12 * * 6",
  interval_days: null,
  enabled: false,
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const retention = (key: string, lastRunAt: string | null, overdue: number | null) => ({
  key,
  last_run_at: lastRunAt,
  last_count: 0,
  overdue,
});

const world = (rpc: FakeDbOptions["rpc"] = {}) =>
  fakeDb({
    rpc: {
      audit_usage: () => ({ db_bytes: 1000, storage_bytes: 2000 }),
      audit_health: () => ({ retention: [], assets_pending: 0 }),
      audit_not_found: () => [
        { path: "/gone", count: 3, top_referrer_host: "ref.example", redirected: false },
      ],
      kpi_weekly: ({ p_week_start }) => week(p_week_start),
      audit_record_run: () => RUN_AT,
      ...rpc,
    },
    tables: { schedule_settings: [auditRow] },
  });

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "allowed";
  } catch (error) {
    return error instanceof ForbiddenError
      ? `${String(error.status)} ${error.code}`
      : String(error);
  }
};

describe("the auditor's endpoints", () => {
  it("lets the auditor read usage, health, notfound, kpis and its schedule row", async () => {
    const db = world();
    expect(await getUsage(AUDITOR, db)).toEqual({ db_bytes: 1000, storage_bytes: 2000 });
    expect(await getHealth(AUDITOR, db, NOW)).toMatchObject({ retention_stalled: [] });
    expect(await listNotFound(AUDITOR, db, 7)).toEqual({
      items: [{ path: "/gone", count: 3, top_referrer_host: "ref.example", redirected: false }],
    });
    expect(await getKpis(AUDITOR, db, "2026-09-28")).toMatchObject({
      current: { week_start: "2026-09-28" },
    });
    expect(await getScheduleSetting(AUDITOR, db, { key: "audit" }, NOW)).toMatchObject({
      key: "audit",
      enabled: false,
    });
  });

  it("refuses the auditor the schedule put by role and a job retry by scope, before any call", async () => {
    const db = world();
    expect(await refusal(putScheduleSettings(AUDITOR, db, { key: "audit", enabled: true }))).toBe(
      "403 forbidden",
    );
    expect(
      await refusal(retryJob(AUDITOR, db, { id: "00000000-0000-4000-8000-0000000000j1" })),
    ).toBe("403 out_of_scope");
    expect(db.calls).toEqual([]);
  });

  it("records a run as the auditor through one audit_record_run call and returns its time", async () => {
    const db = world();
    expect(await recordAuditRun(AUDITOR, db)).toEqual({ last_run_at: RUN_AT });
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "audit_record_run",
        args: [{ p_actor: AUDITOR.userId, p_actor_kind: "agent", p_request_id: "req-audit-1" }],
      },
    ]);
  });

  it("refuses a managing_editor the record-run write without calling the database", async () => {
    const db = world();
    expect(await refusal(recordAuditRun(EDITOR, db))).toBe("403 forbidden");
    expect(db.calls).toEqual([]);
  });

  it("returns collectWeeklyKpis output unchanged, for the last full week when none is named", async () => {
    const answer = await getKpis(AUDITOR, world(), undefined, NOW);
    expect(answer).toEqual(await collectWeeklyKpis(world(), "2026-09-28"));
  });

  it("turns an overdue retention count or a run older than 2 days into retention_stalled", async () => {
    const db = world({
      audit_health: () => ({
        retention: [
          retention("jobs_done", "2026-10-10T03:00:00Z", 4),
          retention("rate_limits", "2026-10-10T03:00:00Z", 0),
          retention("email_pii", "2026-10-07T03:00:00Z", null),
          retention("webhook_receipts", null, 0),
        ],
      }),
    });
    const health = await getHealth(AUDITOR, db, NOW);
    expect(health.retention_stalled.map((row) => row.key)).toEqual([
      "jobs_done",
      "email_pii",
      "webhook_receipts",
    ]);
  });
});
