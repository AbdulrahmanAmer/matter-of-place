// B7 invariant 21 (a): the copy_submission_media system job. A fake client answers the two reads, the folder list,
// each copy and the one render request, and records every call.
import { describe, expect, it } from "vitest";
import type { Json } from "../../../src/db";
import { copySubmissionMedia } from "../../../src/server/jobs/system/copy-submission-media";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import type { JsonObject, StepContext } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
const RENDER_JOB = "00000000-0000-4000-8000-0000000000d1";

const mediaId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Setup {
  photos: number;
  /** Ids whose staged object already exists. */
  listed?: number[];
  copyError?: (n: number) => { statusCode: string } | null;
  listError?: boolean;
}

function jobDb({ photos, listed = [], copyError = () => null, listError = false }: Setup) {
  const ids = Array.from({ length: photos }, (_, n) => mediaId(n + 1));
  const staged = (id: string) => `staging/${PROPERTY}/${id}.jpg`;
  const present = new Set(listed.map((n) => `${mediaId(n)}.jpg`));
  const copies: [string, string][] = [];
  const db = fakeDb({
    storage: {
      submissions: {
        list: (folder: unknown) =>
          Promise.resolve(
            listError
              ? { data: null, error: { statusCode: "500" } }
              : {
                  data:
                    folder === `staging/${PROPERTY}` ? [...present].map((name) => ({ name })) : [],
                  error: null,
                },
          ),
        copy: (from: unknown, to: unknown) => {
          copies.push([String(from), String(to)]);
          const error = copyError(copies.length);
          if (error === null) present.add(String(to).split("/").at(-1) ?? "");
          return Promise.resolve({ data: error === null ? { path: to } : null, error });
        },
      },
    },
  });
  const from = (name: string) => {
    db.calls.push({ kind: "from", name, args: [] });
    if (name === "property_media") {
      const rows = ids.map((id) => ({ id, staging_path: staged(id) }));
      return {
        select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: rows, error: null }) }) }),
      };
    }
    if (name === "submission_media") {
      return {
        select: () => ({
          in: (_column: string, wanted: readonly string[]) =>
            Promise.resolve({
              data: wanted.map((id) => ({ id, storage_path: `${SUBMISSION}/${id}.jpg` })),
              error: null,
            }),
        }),
      };
    }
    throw new Error(`unexpected table ${name}`);
  };
  const rpc = (name: string, args: unknown) => {
    db.calls.push({ kind: "rpc", name, args: [args] });
    if (name !== "request_property_render") throw new Error(`unexpected rpc ${name}`);
    return Promise.resolve({ data: RENDER_JOB, error: null });
  };
  return { db: Object.assign(db, { from, rpc }), copies };
}

function context(db: StepContext["db"], result: Json | null = null): StepContext {
  return {
    db,
    env: {},
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "copy_submission_media",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result,
      eventId: null,
    },
  };
}

const data: JsonObject = { property_id: PROPERTY };
const renders = (calls: { kind: string; name: string }[]) =>
  calls.filter((call) => call.name === "request_property_render").length;

describe("copy_submission_media", () => {
  it("is registered as a system job", () => {
    expect(getSystemJob("copy_submission_media")).toBe(copySubmissionMedia);
  });

  it("copies each photograph to its staging path by id, then asks once for the property's render", async () => {
    const { db, copies } = jobDb({ photos: 3 });
    const outcome = await copySubmissionMedia.run(context(db), {}, data);
    expect({ outcome, copies, renders: renders(db.calls) }).toEqual({
      outcome: { status: "done", result: { copied: 3, render_job_id: RENDER_JOB } },
      copies: [1, 2, 3].map((n) => [
        `${SUBMISSION}/${mediaId(n)}.jpg`,
        `staging/${PROPERTY}/${mediaId(n)}.jpg`,
      ]),
      renders: 1,
    });
  });

  it("copies at most 20 a run and comes back at once while any remain, then finishes with the total", async () => {
    const { db, copies } = jobDb({ photos: 40 });
    const first = await copySubmissionMedia.run(context(db), {}, data);
    expect({ first, copied: copies.length, renders: renders(db.calls) }).toEqual({
      first: { status: "retry_at", at: NOW, reason: "copy_more", result: { copied: 20 } },
      copied: 20,
      renders: 0,
    });
    const second = await copySubmissionMedia.run(context(db, { copied: 20 }), {}, data);
    expect({ second, copied: copies.length, renders: renders(db.calls) }).toEqual({
      second: { status: "done", result: { copied: 40, render_job_id: RENDER_JOB } },
      copied: 40,
      renders: 1,
    });
  });

  it("lists the folder once a run and copies only the objects that are missing", async () => {
    const { db, copies } = jobDb({ photos: 3, listed: [1, 3] });
    await copySubmissionMedia.run(context(db), {}, data);
    expect({
      copies: copies.map(([, to]) => to),
      lists: db.calls.filter((call) => call.name === "submissions.list").length,
    }).toEqual({ copies: [`staging/${PROPERTY}/${mediaId(2)}.jpg`], lists: 1 });
  });

  it("counts an object that already exists as copied", async () => {
    const { db } = jobDb({ photos: 2, copyError: (n) => (n === 1 ? { statusCode: "409" } : null) });
    expect(await copySubmissionMedia.run(context(db), {}, data)).toEqual({
      status: "done",
      result: { copied: 2, render_job_id: RENDER_JOB },
    });
  });

  it("throws storage_unavailable on any other Storage error, so the job backs off and retries", async () => {
    const copy = jobDb({ photos: 2, copyError: () => ({ statusCode: "500" }) });
    await expect(copySubmissionMedia.run(context(copy.db), {}, data)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    const list = jobDb({ photos: 2, listError: true });
    await expect(copySubmissionMedia.run(context(list.db), {}, data)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(renders([...copy.db.calls, ...list.db.calls])).toBe(0);
  });

  it("refuses a payload without a property id for good", async () => {
    const { db } = jobDb({ photos: 0 });
    await expect(copySubmissionMedia.run(context(db), {}, {})).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });
});
