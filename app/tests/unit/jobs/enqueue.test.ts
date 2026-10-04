import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogEventTypes, emitEvent } from "../../../src/server/lib/events";
import { enqueueJob, enqueueManualJob } from "../../../src/server/lib/jobs";
import { fakeDb } from "../../fixtures/fake-db";

const JOB_ID = "3f2a9c1d-0000-4000-8000-000000000001";
const ENTITY_ID = "3f2a9c1d-0000-4000-8000-000000000002";

const rpcArgs = (db: ReturnType<typeof fakeDb>, name: string): unknown[] =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).map((call) => call.args[0]);

describe("enqueueJob", () => {
  it("writes the envelope with empty params and leaves max_attempts to the SQL default", async () => {
    const db = fakeDb({ rpc: { enqueue_job: () => JOB_ID } });
    const id = await enqueueJob(db, {
      type: "health",
      idempotencyKey: "health:2026-10-04",
      data: { date: "2026-10-04" },
    });
    expect(id).toBe(JOB_ID);
    expect(rpcArgs(db, "enqueue_job")).toEqual([
      {
        p_type: "health",
        p_payload: { params: {}, data: { date: "2026-10-04" } },
        p_idempotency_key: "health:2026-10-04",
        p_heavy: false,
      },
    ]);
  });

  it("passes maxAttempts as p_max_attempts and runAfter as an ISO time (DL-10)", async () => {
    const db = fakeDb({ rpc: { enqueue_job: () => JOB_ID } });
    await enqueueJob(db, {
      type: "webhook_omnikom",
      idempotencyKey: "webhook_omnikom:1",
      maxAttempts: 12,
      runAfter: new Date("2026-10-04T12:00:00.000Z"),
    });
    expect(rpcArgs(db, "enqueue_job")).toEqual([
      {
        p_type: "webhook_omnikom",
        p_payload: { params: {}, data: {} },
        p_idempotency_key: "webhook_omnikom:1",
        p_heavy: false,
        p_run_after: "2026-10-04T12:00:00.000Z",
        p_max_attempts: 12,
      },
    ]);
  });

  it("throws unavailable when the RPC fails", async () => {
    const db = fakeDb({ rpc: { enqueue_job: () => new Error("boom") } });
    await expect(enqueueJob(db, { type: "prune", idempotencyKey: "prune:x" })).rejects.toThrow(
      "The job system did not answer (enqueue_job).",
    );
  });
});

describe("enqueueManualJob", () => {
  it("calls enqueue_job_manual with the envelope and the entity", async () => {
    const db = fakeDb({ rpc: { enqueue_job_manual: () => JOB_ID } });
    await enqueueManualJob(db, {
      type: "forward_inquiry",
      entityId: ENTITY_ID,
      data: { inquiry_id: ENTITY_ID },
      maxAttempts: 12,
    });
    expect(rpcArgs(db, "enqueue_job_manual")).toEqual([
      {
        p_type: "forward_inquiry",
        p_entity_id: ENTITY_ID,
        p_payload: { params: {}, data: { inquiry_id: ENTITY_ID } },
        p_max_attempts: 12,
      },
    ]);
  });
});

describe("emitEvent", () => {
  it("calls emit_event and returns the event id", async () => {
    const db = fakeDb({ rpc: { emit_event: () => JOB_ID } });
    const id = await emitEvent(db, {
      type: "property.published",
      entity: "property",
      entityId: ENTITY_ID,
      payload: { property_id: ENTITY_ID },
    });
    expect(id).toBe(JOB_ID);
    expect(rpcArgs(db, "emit_event")).toEqual([
      {
        p_type: "property.published",
        p_entity: "property",
        p_entity_id: ENTITY_ID,
        p_payload: { property_id: ENTITY_ID },
      },
    ]);
  });

  it("holds the 18 types of the events check constraint (G29)", () => {
    const file = readdirSync("supabase/migrations").find((name) => name.endsWith("_jobs.sql"));
    const sql = readFileSync(`supabase/migrations/${file ?? "missing"}`, "utf8");
    const list = /type text not null check \(type in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const inMigration = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(catalogEventTypes).toHaveLength(18);
    expect([...catalogEventTypes].sort()).toEqual(inMigration.sort());
  });
});
