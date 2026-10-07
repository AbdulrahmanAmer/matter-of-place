import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { entityTimeline } from "../../src/server/lib/timeline";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// The history of one request or property (B7 step 5, screens 4 and 8): audit rows and job events as one list.

const ENTITY = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const PROPERTY = "00000000-0000-4000-8000-0000000000e3";
const JOB_BY_EVENT = "00000000-0000-4000-8000-0000000000b1";
const JOB_BY_PAYLOAD = "00000000-0000-4000-8000-0000000000b2";
const JOB_OF_OTHER = "00000000-0000-4000-8000-0000000000b3";

const audit = (id: number, at: string, entity: string, entityId: string, action: string) => ({
  id,
  at,
  entity,
  entity_id: entityId,
  action,
  actor_id: "00000000-0000-4000-8000-0000000000a1",
  actor_kind: "human",
  note: null,
});

const jobEvent = (id: number, at: string, jobId: string, kind: string) => ({
  id,
  at,
  job_id: jobId,
  kind,
  message: null,
  actor_id: null,
});

const job = (id: string, type: string, eventEntity: string | null, data: object = {}) => ({
  id,
  type,
  created_at: "2026-10-01T09:00:00+00:00",
  job_event_entity_id: eventEntity,
  idempotency_key: `${type}:${id}`,
  payload: { params: {}, data },
});

function setup() {
  return withTables(fakeDb(), {
    audit_log: [
      audit(1, "2026-10-01T10:00:00+00:00", "submission", ENTITY, "submissions.start_review"),
      audit(2, "2026-10-01T12:00:00+00:00", "submission", ENTITY, "submissions.note"),
      audit(3, "2026-10-01T13:00:00+00:00", "submission", OTHER, "submissions.note"),
      audit(4, "2026-10-01T14:00:00+00:00", "property", PROPERTY, "properties.update"),
    ],
    jobs: [
      job(JOB_BY_EVENT, "send_email", ENTITY),
      job(JOB_BY_PAYLOAD, "copy_submission_media", null, { property_id: PROPERTY }),
      job(JOB_OF_OTHER, "send_email", OTHER),
    ],
    job_events: [
      jobEvent(10, "2026-10-01T11:00:00+00:00", JOB_BY_EVENT, "finished"),
      jobEvent(11, "2026-10-01T09:30:00+00:00", JOB_BY_PAYLOAD, "started"),
      jobEvent(12, "2026-10-01T15:00:00+00:00", JOB_OF_OTHER, "finished"),
    ],
  });
}

describe("entityTimeline", () => {
  it("merges the audit rows and the job events of the entity, newest first, each tagged by source", async () => {
    const entries = await entityTimeline(setup(), "submission", ENTITY);
    expect(entries.map((entry) => [entry.source, entry.action, entry.job_type])).toEqual([
      ["audit", "submissions.note", null],
      ["job", "finished", "send_email"],
      ["audit", "submissions.start_review", null],
    ]);
  });

  it("includes a job found only through payload.data.property_id, which has no event", async () => {
    const entries = await entityTimeline(setup(), "property", PROPERTY);
    expect(entries.map((entry) => [entry.source, entry.action, entry.job_type])).toEqual([
      ["audit", "properties.update", null],
      ["job", "started", "copy_submission_media"],
    ]);
  });

  it("makes three reads and no write", async () => {
    const db = setup();
    await entityTimeline(db, "submission", ENTITY);
    expect(db.calls.map((call) => `${call.kind}:${call.name}`).sort()).toEqual([
      "from:audit_log",
      "from:job_events",
      "from:jobs",
    ]);
  });

  it("reads no job events when the entity has no job", async () => {
    const db = withTables(fakeDb(), { audit_log: [], jobs: [] });
    expect(await entityTimeline(db, "submission", ENTITY)).toEqual([]);
  });
});
