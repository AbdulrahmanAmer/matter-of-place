import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAdmin } from "../../../src/server/jobs/steps/notify-admin";
import {
  emailEnv,
  emailWorld,
  EVENT_ID,
  fakeFetch,
  JOB_ID,
  JOB_KEY,
  NOW,
  stepCtx,
} from "../../fixtures/email-send";

// The `digest.due` notice (B11 Contract 1): it says what the `queue_digest` job of the same event found, and waits
// for that job while it is queued, so it never reads a draft before it exists.

const ISSUE = "5e1f0a00-0000-4000-8000-000000000903";

function setup(digest: { status: string; result?: unknown } | undefined) {
  const fetch = fakeFetch();
  const jobs = [
    { id: JOB_ID, idempotency_key: JOB_KEY, event_id: EVENT_ID, type: "notify_admin" },
    ...(digest === undefined
      ? []
      : [{ id: "sibling", event_id: EVENT_ID, type: "queue_digest", result: null, ...digest }]),
  ];
  const { db, messages } = emailWorld({ eventType: "digest.due", tables: { jobs } });
  const ctx = stepCtx(db, { type: "notify_admin", eventId: EVENT_ID });
  return { fetch, messages, run: () => notifyAdmin.run(ctx, {}, {}) };
}

beforeEach(() => {
  emailEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("digest.due notice", () => {
  it("retries a minute later while the queue_digest job is queued, and sends nothing", async () => {
    const { run, fetch, messages } = setup({ status: "queued" });
    expect(await run()).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 60 * 1000),
      reason: "waiting_queue_digest",
    });
    expect([fetch.requests.length, messages.length]).toEqual([0, 0]);
  });

  it("says nothing to send this cycle when the issue is null", async () => {
    const { run, fetch } = setup({ status: "done", result: { issue_id: null } });
    await run();
    expect(fetch.requests[0]?.body.subject).toBe("Nothing to send this cycle");
  });

  it("says the draft of issue 3 is ready for review", async () => {
    const { run, fetch } = setup({ status: "done", result: { issue_id: ISSUE, number: 3 } });
    await run();
    expect(fetch.requests[0]?.body.subject).toBe("Place Notes No. 3 draft ready for review");
    expect(fetch.requests[0]?.body.text).toContain(`/admin/newsletter/${ISSUE}`);
  });

  it("says the draft could not be built when the job is dead", async () => {
    const { run, fetch } = setup({ status: "dead" });
    await run();
    expect(fetch.requests[0]?.body.subject).toBe("Place Notes draft could not be built");
    expect(fetch.requests[0]?.body.text).toContain(`/admin/jobs?event_id=${EVENT_ID}`);
  });

  it("is a failure, not a wait, when the event has no queue_digest job", async () => {
    const { run } = setup(undefined);
    await expect(run()).rejects.toThrow("queue_digest_job");
  });
});
