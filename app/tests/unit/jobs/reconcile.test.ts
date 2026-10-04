// B8 step 8: the reconcile system job (G10). B3's reconcileUploads is passed in as a fake, so the cases prove which
// `since` the job hands it and what it stores.
import { describe, expect, it, vi } from "vitest";
import type { JsonObject, StepContext } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  reconcileJob,
  type ReconcileUploads,
  type UploadCounts,
} from "../../../src/server/jobs/system/reconcile";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T13:00:00.000Z");
const COUNTS: UploadCounts = { checked: 3, uploaded: 2, deleted: 1, missing: 0 };

/** A context whose one jobs read answers the latest done reconcile run, or none. */
function context(lastFinishedAt: string | null): StepContext {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: lastFinishedAt === null ? null : { finished_at: lastFinishedAt },
        error: null,
      }),
  };
  return {
    db: Object.assign(fakeDb(), { from: () => chain }),
    env: {},
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "reconcile",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

async function sinceGiven(lastFinishedAt: string | null, data: JsonObject = {}): Promise<string> {
  const uploads = vi.fn<ReconcileUploads>(() => Promise.resolve(COUNTS));
  await reconcileJob(uploads).run(context(lastFinishedAt), {}, data);
  const since = uploads.mock.calls[0]?.[1];
  if (since === undefined) throw new Error("reconcileUploads was not called");
  return since.toISOString();
}

describe("reconcile", () => {
  it("passes data.since when the job carries it", async () => {
    expect(
      await sinceGiven("2026-10-04T12:45:00.000Z", { since: "2026-10-01T00:00:00.000Z" }),
    ).toBe("2026-10-01T00:00:00.000Z");
  });

  it("else passes the last done run's finished_at minus 15 minutes", async () => {
    expect(await sinceGiven("2026-10-04T12:45:00.000Z")).toBe("2026-10-04T12:30:00.000Z");
  });

  it("else passes 24 hours before now", async () => {
    expect(await sinceGiven(null)).toBe("2026-10-03T13:00:00.000Z");
  });

  it("stores the counts under result.uploads", async () => {
    const result = await reconcileJob(() => Promise.resolve(COUNTS)).run(context(null), {}, {});
    expect(result).toEqual({ status: "done", result: { uploads: COUNTS } });
  });

  it("throws when reconcileUploads throws, so the runner retries", async () => {
    const failing = reconcileJob(() => Promise.reject(new Error("storage_list_failed")));
    await expect(failing.run(context(null), {}, {})).rejects.toThrow("storage_list_failed");
  });

  it("refuses an unreadable data.since without retrying", async () => {
    const job = reconcileJob(() => Promise.resolve(COUNTS));
    await expect(job.run(context(null), {}, { since: "yesterday-ish" })).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });
});
