import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import {
  addNote,
  getSubmission,
  newestPaymentId,
  originalUrl,
  startReview,
  timeline,
} from "../../src/server/submissions/service";
import { fakeDb, type FakeDb, type FakeDbOptions } from "../fixtures/fake-db";
import { withTables, type Row } from "../fixtures/table-stub";

// The admin service of a request (B7 steps 4 and 5): who may read it and note it, who may move it, and what a refused
// move answers.

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-sr",
});

const ids = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("startReview", () => {
  it("moves a whole selection in one start_review call and answers how many started", async () => {
    const db = fakeDb({ rpc: { start_review: (args) => args.p_submission_ids.length } });
    const answer = await startReview(actor(["managing_editor"]), db, { ids });
    expect({ answer, rpc: db.calls.map((call) => call.name) }).toEqual({
      answer: { started: 2 },
      rpc: ["start_review"],
    });
  });

  it("refuses a visual editor with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(startReview(actor(["visual_editor"]), db, { ids })),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });

  it("answers 409 wrong_state when a request of the selection has moved on", async () => {
    const db = fakeDb({
      rpc: { start_review: () => Object.assign(new Error("wrong_state"), { code: "P0001" }) },
    });
    expect(await outcome(startReview(actor(["chief_editor"]), db, { ids }))).toEqual({
      status: 409,
      code: "wrong_state",
    });
  });
});

const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
const OTHER_SUBMISSION = "00000000-0000-4000-8000-0000000000c9";
const PHOTO_ONE = "00000000-0000-4000-8000-0000000000d1";
const PHOTO_TWO = "00000000-0000-4000-8000-0000000000d2";
const PHOTO_ELSEWHERE = "00000000-0000-4000-8000-0000000000d9";
const NOTE = "00000000-0000-4000-8000-0000000000f1";

const submissionRow: Row = {
  id: SUBMISSION,
  received_at: "2026-10-01T12:00:00+00:00",
  workflow_state: "Under Review",
  accepted_at: null,
  decline_note: null,
  duplicate_of: null,
  address: "12 Fixture Lane",
  city: "Montecito",
  state: "California",
  zip: "93108",
  property_type: "Residence",
  price: 4_500_000,
  currency: "USD",
  beds: 5,
  baths: 4.5,
  interior_sq_ft: 4320,
  year_built: 1998,
  year_renovated: null,
  architect: null,
  designer: null,
  package: "The Feature",
  media_budget: null,
  contact_id: null,
  submitter_kind: "agent",
  submitter_name: "Ana Fixture",
  submitter_email: "ana@example.test",
  submitter_phone: null,
  brokerage: "Fixture Brokerage",
  listed_with_agent: null,
  listing_agent_name: null,
  listing_agent_brokerage: null,
  listing_url: null,
  source_url: null,
  photography_url: null,
  video_url: null,
  story: "A house on a hill.",
  significance: "Built for the view.",
  notes: [
    {
      id: NOTE,
      text: "Call the agent",
      actor_id: "00000000-0000-4000-8000-000000000001",
      actor_kind: "human",
      at: "2026-10-01T13:00:00+00:00",
    },
  ],
};

const photo = (id: string, sortOrder: number, submissionId = SUBMISSION): Row => ({
  id,
  submission_id: submissionId,
  name: `${id}.jpg`,
  mime: "image/jpeg",
  bytes: 1000,
  sort_order: sortOrder,
  uploaded_at: "2026-10-01T12:05:00+00:00",
  storage_path: `${submissionId}/${id}.jpg`,
});

const thumbPaths = [`${SUBMISSION}/${PHOTO_ONE}.thumb.jpg`, `${SUBMISSION}/${PHOTO_TWO}.thumb.jpg`];
const signedUrl = (path: string) => `https://signed.test/${path}`;

function detailDb(payments: Row[] = [], storage?: FakeDbOptions["storage"]): FakeDb {
  return withTables(fakeDb(storage === undefined ? {} : { storage }), {
    submissions: [submissionRow],
    submission_media: [
      photo(PHOTO_TWO, 2),
      photo(PHOTO_ONE, 1),
      photo(PHOTO_ELSEWHERE, 1, OTHER_SUBMISSION),
    ],
    properties: [],
    payments,
  });
}

/** What Storage answers to `createSignedUrls`: a URL per path, and a per-path error for each path in `missing`. */
const signing =
  (missing: readonly string[] = []) =>
  (paths: unknown) =>
    Promise.resolve({
      data: (Array.isArray(paths) ? paths.map(String) : []).map((path) =>
        missing.includes(path)
          ? { error: "Object not found", path, signedURL: null, signedUrl: null }
          : { error: null, path, signedURL: `/sign/${path}`, signedUrl: signedUrl(path) },
      ),
      error: null,
    });

const storageCalls = (db: FakeDb) =>
  db.calls.filter((call) => call.kind === "storage").map((call) => [call.name, ...call.args]);

describe("getSubmission", () => {
  it("lets a commercial reader open a request, with its photographs in order and its notes", async () => {
    const db = detailDb([], { submissions: { createSignedUrls: signing() } });
    const detail = await getSubmission(actor(["commercial"]), db, { id: SUBMISSION });
    expect({
      address: detail.address,
      photos: detail.media.map((entry) => entry.id),
      notes: detail.notes.map((note) => note.text),
    }).toEqual({
      address: "12 Fixture Lane",
      photos: [PHOTO_ONE, PHOTO_TWO],
      notes: ["Call the agent"],
    });
  });

  it("asks Storage once for the thumbnails of bucket submissions for 3600 seconds, never for an original", async () => {
    const db = detailDb([], { submissions: { createSignedUrls: signing() } });
    const detail = await getSubmission(actor(["visual_editor"]), db, { id: SUBMISSION });
    expect({ calls: storageCalls(db), urls: detail.media.map((entry) => entry.thumb_url) }).toEqual(
      {
        calls: [["submissions.createSignedUrls", thumbPaths, 3600]],
        urls: thumbPaths.map(signedUrl),
      },
    );
  });

  it("gives thumb_url null for a photograph whose thumbnail has no object", async () => {
    const [first = "", second = ""] = thumbPaths;
    const db = detailDb([], { submissions: { createSignedUrls: signing([second]) } });
    const detail = await getSubmission(actor(["chief_editor"]), db, { id: SUBMISSION });
    expect(detail.media.map((entry) => entry.thumb_url)).toEqual([signedUrl(first), null]);
  });

  it("gives thumb_url null for every photograph when Storage fails, and still answers", async () => {
    const db = detailDb([], {
      submissions: {
        createSignedUrls: () => Promise.resolve({ data: null, error: new Error("storage down") }),
      },
    });
    const detail = await getSubmission(actor(["chief_editor"]), db, { id: SUBMISSION });
    expect(detail.media.map((entry) => entry.thumb_url)).toEqual([null, null]);
  });

  it("answers 404 for a request that does not exist, and calls Storage for nothing", async () => {
    const db = withTables(fakeDb(), {
      submissions: [],
      submission_media: [],
      properties: [],
      payments: [],
    });
    expect({
      answer: await outcome(getSubmission(actor(["chief_editor"]), db, { id: SUBMISSION })),
      storage: storageCalls(db),
    }).toEqual({ answer: { status: 404, code: "not_found" }, storage: [] });
  });

  it("returns payment_id null for a request without payments", async () => {
    const db = detailDb([], { submissions: { createSignedUrls: signing() } });
    const detail = await getSubmission(actor(["commercial"]), db, { id: SUBMISSION });
    expect(detail.payment_id).toBeNull();
  });
});

describe("newestPaymentId", () => {
  const payment = (id: string, status: string, created: string, submission = SUBMISSION): Row => ({
    id,
    status,
    submission_id: submission,
    created_at: `2026-10-0${created}T00:00:00+00:00`,
  });

  it("returns the id of the newest payment of the request that is not void", async () => {
    const db = detailDb([
      payment("p-void", "void", "3"),
      payment("p-paid", "paid", "2"),
      payment("p-due", "due", "1"),
      payment("p-other", "paid", "4", OTHER_SUBMISSION),
    ]);
    expect(await newestPaymentId(db, SUBMISSION)).toBe("p-paid");
  });

  it("returns null when every payment of the request is void", async () => {
    const db = detailDb([payment("p-void", "void", "3")]);
    expect(await newestPaymentId(db, SUBMISSION)).toBeNull();
  });
});

describe("originalUrl", () => {
  it("signs the one original for 600 seconds and answers its URL", async () => {
    const db = detailDb([], {
      submissions: {
        createSignedUrl: (path: unknown) =>
          Promise.resolve({ data: { signedUrl: signedUrl(String(path)) }, error: null }),
      },
    });
    const path = `${SUBMISSION}/${PHOTO_ONE}.jpg`;
    const answer = await originalUrl(actor(["commercial"]), db, {
      id: SUBMISSION,
      mediaId: PHOTO_ONE,
    });
    expect({ answer, calls: storageCalls(db) }).toEqual({
      answer: { url: signedUrl(path) },
      calls: [["submissions.createSignedUrl", path, 600]],
    });
  });

  it("answers 404 for a photograph of another request, and signs nothing", async () => {
    const db = detailDb();
    expect({
      answer: await outcome(
        originalUrl(actor(["chief_editor"]), db, { id: SUBMISSION, mediaId: PHOTO_ELSEWHERE }),
      ),
      storage: storageCalls(db),
    }).toEqual({ answer: { status: 404, code: "not_found" }, storage: [] });
  });
});

describe("addNote", () => {
  it("lets a visual editor add a note through add_submission_note, naming the actor", async () => {
    const db = fakeDb({
      rpc: {
        add_submission_note: (args) => ({
          id: NOTE,
          text: args.p_text,
          actor_id: args.p_actor,
          actor_kind: args.p_actor_kind,
          at: "2026-10-02T09:00:00+00:00",
        }),
      },
    });
    const answer = await addNote(actor(["visual_editor"]), db, {
      id: SUBMISSION,
      text: "Check the lot",
    });
    expect({
      text: answer.text,
      actor: answer.actor_id,
      rpc: db.calls.map((call) => call.name),
    }).toEqual({
      text: "Check the lot",
      actor: "00000000-0000-4000-8000-000000000001",
      rpc: ["add_submission_note"],
    });
  });

  it("refuses a commercial reader with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(addNote(actor(["commercial"]), db, { id: SUBMISSION, text: "Hello" })),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});

describe("timeline", () => {
  it("lets a commercial reader read the history of a request", async () => {
    const db = withTables(fakeDb(), { audit_log: [], jobs: [] });
    expect(await timeline(actor(["commercial"]), db, { id: SUBMISSION })).toEqual({ items: [] });
  });
});
