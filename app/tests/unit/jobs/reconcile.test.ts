// B8 step 8: the reconcile system job (G10). B3's reconcileUploads and B10's reconcileSocial are passed in as fakes,
// so the cases prove which `since` the job hands the first, what it hands the second, and what it stores; one case
// runs the registered job, with both real parts, against a fake client.
import { describe, expect, it, vi } from "vitest";
import type { JsonObject, StepContext } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  reconcile,
  reconcileJob,
  type ReconcileSocial,
  type ReconcileUploads,
  type UploadCounts,
} from "../../../src/server/jobs/system/reconcile";
import type { Db } from "../../../src/server/lib/db";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T13:00:00.000Z");
const COUNTS: UploadCounts = { checked: 3, uploaded: 2, deleted: 1, missing: 0 };
const SOCIAL: ReconcileSocial = () => Promise.resolve({ social: "not_due" });

/** The jobs read of the job: the latest done reconcile run, or none. */
function jobsChain(lastFinishedAt: string | null) {
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
  return chain;
}

/** A context whose database answers the one jobs read, or the given client. */
function context(lastFinishedAt: string | null, db: Db = jobsOnly(lastFinishedAt)): StepContext {
  return {
    db,
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

function jobsOnly(lastFinishedAt: string | null): Db {
  return Object.assign(fakeDb(), { from: () => jobsChain(lastFinishedAt) });
}

async function sinceGiven(lastFinishedAt: string | null, data: JsonObject = {}): Promise<string> {
  const uploads = vi.fn<ReconcileUploads>(() => Promise.resolve(COUNTS));
  await reconcileJob(uploads, SOCIAL).run(context(lastFinishedAt), {}, data);
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

  it("stores the counts under result.uploads and the social part under result.social", async () => {
    const result = await reconcileJob(() => Promise.resolve(COUNTS), SOCIAL).run(
      context(null),
      {},
      {},
    );
    expect(result).toEqual({ status: "done", result: { uploads: COUNTS, social: "not_due" } });
  });

  it("hands the social part the job's params and the clock of the run", async () => {
    const social = vi.fn<ReconcileSocial>(() => Promise.resolve({ social: "daily_exists" }));
    const ctx = context(null);
    await reconcileJob(() => Promise.resolve(COUNTS), social).run(ctx, { daily: true }, {});
    expect(social).toHaveBeenCalledExactlyOnceWith(ctx, { daily: true }, NOW);
  });

  it("throws when the social part throws, so the runner retries the uploads too", async () => {
    const failing = reconcileJob(
      () => Promise.resolve(COUNTS),
      () => Promise.reject(new Error("complete_distributed_submissions")),
    );
    await expect(failing.run(context(null), {}, {})).rejects.toThrow(
      "complete_distributed_submissions",
    );
  });

  it("throws when reconcileUploads throws, so the runner retries", async () => {
    const failing = reconcileJob(() => Promise.reject(new Error("storage_list_failed")), SOCIAL);
    await expect(failing.run(context(null), {}, {})).rejects.toThrow("storage_list_failed");
  });

  it("runs the real parts: the waiting submission_media rows are read and the day's social run is asked for", async () => {
    const client = fakeDb({
      tables: { submission_media: [] },
      rpc: { enqueue_job: () => "3f2a9c1d-0000-4000-8000-0000000000e0" },
    });
    const tableFrom = client.from.bind(client);
    const db = Object.assign(client, {
      from: (table: "jobs" | "submission_media") =>
        table === "jobs" ? jobsChain(null) : tableFrom(table),
    });
    const result = await reconcile.run(context(null, db), {}, {});
    expect(result).toEqual({
      status: "done",
      result: {
        uploads: { checked: 0, uploaded: 0, deleted: 0, missing: 0 },
        social: "daily_enqueued",
      },
    });
    expect(client.calls).toContainEqual({ kind: "from", name: "submission_media", args: [] });
    expect(client.calls.filter((call) => call.name === "enqueue_job")).toHaveLength(1);
  });

  it("refuses an unreadable data.since without retrying", async () => {
    const job = reconcileJob(() => Promise.resolve(COUNTS), SOCIAL);
    await expect(job.run(context(null), {}, { since: "yesterday-ish" })).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });
});
