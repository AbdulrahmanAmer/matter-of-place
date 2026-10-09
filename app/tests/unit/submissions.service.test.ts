import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { siteConfig } from "../../src/config/site";
import { requestAssetsInputSchema, withdrawInputSchema } from "../../src/domain/admin-submissions";
import { loadSiteContext } from "../../src/server/email/context";
import { renderTemplate } from "../../src/server/email/render";
import { resolveVariables } from "../../src/server/email/variables";
import {
  defineAdminRoute,
  type AdminActor,
  type AdminDeps,
} from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import {
  accept,
  addNote,
  assetsReceived,
  decline,
  emailPreview,
  getSubmission,
  listDeclineReasons,
  newestPaymentId,
  originalUrl,
  requestAssets,
  startReview,
  timeline,
  withdraw,
} from "../../src/server/submissions/service";
import { fakeDb, type FakeDb, type FakeDbOptions } from "../fixtures/fake-db";
import { withTables, type Row } from "../fixtures/table-stub";
import { stateJson } from "../fixtures/snapshot";

// The admin service of a request (B7 steps 4 to 6): who may read it and note it, who may move it, what a refused
// move answers, and what a decision writes, plans and previews.

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

const REASON = "00000000-0000-4000-8000-0000000000e1";
const RETIRED_REASON = "00000000-0000-4000-8000-0000000000e2";
const AT = "2026-10-07T08:00:00+00:00";

const reason = (id: string, label: string, enabled: boolean, sort: number): Row => ({
  id,
  code: label.toLowerCase().replaceAll(" ", "_"),
  label,
  email_paragraph: `${label}: we feature a few homes a month.`,
  sort,
  enabled,
});

// The recipes B8b seeds: each decision event sends its one letter.
const recipes: Row[] = ["declined", "accepted", "awaiting_assets"].map((template, n) => ({
  id: `00000000-0000-4000-8000-00000000010${String(n)}`,
  trigger: `submission.${template}`,
  enabled: true,
  steps: [
    {
      id: `send_${template}`,
      step_type: "send_email",
      params: { template },
      enabled: true,
      requires_approval: false,
      conditions: {},
    },
  ],
}));

const declinedTemplate = {
  key: "declined",
  subject: "About {{property_address}}",
  preheader: "",
  body: [
    { type: "heading", text: "Thank you for submitting {{property_address}}." },
    { type: "paragraph", text: "{{reason_paragraph}}" },
    { type: "paragraph", text: "{{note_paragraph}}" },
    { type: "signature" },
  ],
};

const plannedJobs = z.array(z.object({ type: z.string(), status: z.string() }));

const uuidAt = (prefix: string, n: number) =>
  `00000000-0000-4000-8000-0000000${prefix}${String(n).padStart(2, "0")}`;

/**
 * A database whose three letter-sending decision functions behave as step 6's SQL does (its own proof is
 * `tests/db/admin.db.test.ts`): refuse a request in another state, change the row, write one audit row and one event.
 * `fanout_insert_jobs` keeps the planned jobs in `jobs`, which the service then reads by `event_id`.
 */
function decisionDb(state = "Under Review") {
  const request: Row = { ...submissionRow, workflow_state: state, decline_reason_id: null };
  const tables = {
    submissions: [request],
    decline_reasons: [
      reason(RETIRED_REASON, "Retired reason", false, 2),
      reason(REASON, "Not a fit", true, 1),
    ],
    email_templates: [declinedTemplate],
    settings: [],
    automation_recipes: recipes,
    events: [] as Row[],
    audit_log: [] as Row[],
    jobs: [] as Row[],
  };
  const decide =
    (from: readonly string[], to: string, action: string, type: string) =>
    (args: { p_submission_id: string; p_actor: string }, change: Row, extra: Row = {}) => {
      if (!from.includes(String(request["workflow_state"]))) {
        return Object.assign(new Error("wrong_state"), { code: "P0001" });
      }
      Object.assign(request, { workflow_state: to, ...change });
      tables.audit_log.push({ action, entity_id: args.p_submission_id, actor_id: args.p_actor });
      const id = uuidAt("002", tables.events.length);
      const base = { submission_id: args.p_submission_id, tier: "Feature", market: "california" };
      tables.events.push({ id, type, at: AT, payload: { ...base, ...extra } });
      return id;
    };
  const declineRow = decide(
    ["Under Review"],
    "Declined",
    "submissions.decline",
    "submission.declined",
  );
  const acceptRow = decide(
    ["Under Review"],
    "Accepted",
    "submissions.accept",
    "submission.accepted",
  );
  const askRow = decide(
    ["Under Review", "Accepted"],
    "Awaiting Assets",
    "submissions.request_assets",
    "submission.awaiting_assets",
  );
  const db = withTables(
    fakeDb({
      rpc: {
        decline_submission: (args) =>
          declineRow(
            args,
            {
              decline_reason_id: args.p_reason_id,
              decline_note: args.p_note,
              reviewed_by: args.p_actor,
            },
            {
              decline_reason_id: args.p_reason_id,
              ...(args.p_note === "" ? {} : { note: args.p_note }),
            },
          ),
        public_state: () => stateJson(7, { site: null }),
        accept_submission: (args) =>
          acceptRow(args, { accepted_by: args.p_actor, accepted_at: AT }),
        request_assets: (args) => askRow(args, {}, { note: args.p_note }),
        fanout_insert_jobs: (args) => {
          const planned = plannedJobs.parse(args.p_jobs);
          for (const job of planned) {
            tables.jobs.push({
              id: uuidAt("003", tables.jobs.length),
              event_id: args.p_event_id,
              ...job,
            });
          }
          return planned.length;
        },
      },
    }),
    tables,
  );
  return { db, tables, request };
}

const rpcNames = (db: FakeDb) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

describe("decisions", () => {
  it("decline writes the state, the reason and the reviewer, one audit row and one submission.declined event, and answers its send_email job", async () => {
    const { db, tables, request } = decisionDb();
    const answer = await decline(actor(["managing_editor"]), db, {
      id: SUBMISSION,
      decline_reason_id: REASON,
      note: "Not this season.",
    });
    expect({
      request: {
        state: request["workflow_state"],
        reason: request["decline_reason_id"],
        reviewer: request["reviewed_by"],
      },
      audits: tables.audit_log.map((row) => row["action"]),
      events: tables.events.map((row) => row["type"]),
      answer,
    }).toEqual({
      request: {
        state: "Declined",
        reason: REASON,
        reviewer: "00000000-0000-4000-8000-000000000001",
      },
      audits: ["submissions.decline"],
      events: ["submission.declined"],
      answer: {
        event_id: uuidAt("002", 0),
        jobs: [{ id: uuidAt("003", 0), type: "send_email", status: "queued" }],
      },
    });
  });

  it("the decline preview is the letter send_email renders from the declined event's payload", async () => {
    const { db, tables } = decisionDb();
    const note = "We hope to read the next one.";
    const preview = await emailPreview(actor(["chief_editor"]), db, {
      id: SUBMISSION,
      template: "declined",
      decline_reason_id: REASON,
      note,
    });
    await decline(actor(["chief_editor"]), db, { id: SUBMISSION, decline_reason_id: REASON, note });
    const payload = z.record(z.string(), z.string()).parse(tables.events[0]?.["payload"]);
    const site = await loadSiteContext(db, siteConfig.url);
    const sent = await renderTemplate(
      declinedTemplate,
      await resolveVariables(db, "declined", payload, undefined, site),
      site,
    );
    expect({ same: preview.html === sent.html, note: sent.html.includes(note) }).toEqual({
      same: true,
      note: true,
    });
  });

  it("accept sets accepted_by and accepted_at and writes one submission.accepted event with the request, tier and market", async () => {
    const { db, tables, request } = decisionDb();
    const answer = await accept(actor(["chief_editor"]), db, { id: SUBMISSION });
    expect({
      acceptedBy: request["accepted_by"],
      acceptedAt: request["accepted_at"],
      events: tables.events.map((row) => [row["type"], row["payload"]]),
      jobs: answer.jobs.map((job) => job.type),
    }).toEqual({
      acceptedBy: "00000000-0000-4000-8000-000000000001",
      acceptedAt: AT,
      events: [
        [
          "submission.accepted",
          { submission_id: SUBMISSION, tier: "Feature", market: "california" },
        ],
      ],
      jobs: ["send_email"],
    });
  });

  it("request_assets writes one submission.awaiting_assets event carrying the dialog's note", async () => {
    const { db, tables } = decisionDb("Accepted");
    await requestAssets(actor(["managing_editor"]), db, {
      id: SUBMISSION,
      note: "Ten interiors and a plan.",
    });
    expect(tables.events.map((row) => [row["type"], row["payload"]])).toEqual([
      [
        "submission.awaiting_assets",
        {
          submission_id: SUBMISSION,
          tier: "Feature",
          market: "california",
          note: "Ten interiors and a plan.",
        },
      ],
    ]);
  });

  it("request-assets without a note answers 422 and asks the database nothing", async () => {
    const db = fakeDb();
    const deps: AdminDeps = {
      db: () => db,
      requireActor: () =>
        Promise.resolve({
          userId: "00000000-0000-4000-8000-000000000001",
          kind: "human",
          roles: ["managing_editor"],
          scopes: [],
        }),
      verifyCsrf: () => Promise.resolve(),
      assertSessionFresh: () => undefined,
      requireRecentAuth: () => undefined,
    };
    const route = defineAdminRoute(
      {
        method: "POST",
        action: "submissions.request_assets",
        input: requestAssetsInputSchema,
        handler: (ctx, input) => requestAssets(ctx.actor, ctx.db, input),
      },
      deps,
    );
    const response = await route({
      request: new Request(
        `https://example.test/api/admin/submissions/${SUBMISSION}/request-assets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: "  " }),
        },
      ),
      context: { requestId: "req-ra" },
      params: { id: SUBMISSION },
    });
    expect({ status: response.status, calls: db.calls.length }).toEqual({ status: 422, calls: 0 });
  });

  it("assets_received answers where the request went back to and writes no event", async () => {
    const db = fakeDb({ rpc: { assets_received: () => "Accepted" } });
    const answer = await assetsReceived(actor(["managing_editor"]), db, { id: SUBMISSION });
    expect({ answer, rpc: rpcNames(db) }).toEqual({
      answer: { workflow_state: "Accepted" },
      rpc: ["assets_received"],
    });
  });

  it("an agent over its daily cap gets 429 agent_daily_limit and nothing is planned", async () => {
    const db = fakeDb({
      rpc: {
        decline_submission: () => Object.assign(new Error("agent_daily_limit"), { code: "P0001" }),
      },
    });
    const agent: AdminActor = {
      ...actor(["managing_editor"]),
      kind: "agent",
      scopes: ["submissions"],
    };
    expect({
      answer: await outcome(decline(agent, db, { id: SUBMISSION, decline_reason_id: REASON })),
      rpc: rpcNames(db),
    }).toEqual({
      answer: { status: 429, code: "agent_daily_limit" },
      rpc: ["decline_submission"],
    });
  });

  it("lists the enabled decline reasons in their order, and refuses a commercial reader before the database", async () => {
    const { db } = decisionDb();
    const refused = fakeDb();
    expect({
      reasons: await listDeclineReasons(actor(["managing_editor"]), db),
      commercial: await outcome(listDeclineReasons(actor(["commercial"]), refused)),
      calls: refused.calls.length,
    }).toEqual({
      reasons: { items: [{ id: REASON, code: "not_a_fit", label: "Not a fit" }] },
      commercial: { status: 403, code: "forbidden" },
      calls: 0,
    });
  });
});

describe("withdraw", () => {
  const REASON_TEXT = "The owner sold privately.";
  const due: Row = { id: "p-due", submission_id: SUBMISSION, status: "due" };

  /** A request whose payments are `payments`; `withdraw_submission` records what it was asked and answers Withdrawn. */
  function withdrawDb(payments: Row[] = []) {
    const asked: unknown[] = [];
    const db = withTables(
      fakeDb({
        rpc: {
          withdraw_submission: (args) => {
            asked.push(args);
            return "Withdrawn";
          },
        },
      }),
      { payments },
    );
    return { db, asked };
  }

  it("a managing editor withdraws an Accepted request in one withdraw_submission call carrying the reason", async () => {
    const { db, asked } = withdrawDb();
    const answer = await withdraw(actor(["managing_editor"]), db, {
      id: SUBMISSION,
      reason: REASON_TEXT,
    });
    expect({ answer, rpc: rpcNames(db), asked }).toEqual({
      answer: { workflow_state: "Withdrawn" },
      rpc: ["withdraw_submission"],
      asked: [
        {
          p_submission_id: SUBMISSION,
          p_reason: REASON_TEXT,
          p_actor: "00000000-0000-4000-8000-000000000001",
          p_actor_kind: "human",
          p_request_id: "req-sr",
        },
      ],
    });
  });

  it("with a due invoice it needs payments.void: a managing editor gets 403 and nothing moves, an admin withdraws", async () => {
    const editor = withdrawDb([due]);
    const admin = withdrawDb([due]);
    expect({
      editor: await outcome(
        withdraw(actor(["managing_editor"]), editor.db, { id: SUBMISSION, reason: REASON_TEXT }),
      ),
      editorRpc: rpcNames(editor.db),
      admin: await withdraw(actor(["admin"]), admin.db, { id: SUBMISSION, reason: REASON_TEXT }),
      adminRpc: rpcNames(admin.db),
    }).toEqual({
      editor: { status: 403, code: "forbidden" },
      editorRpc: [],
      admin: { workflow_state: "Withdrawn" },
      adminRpc: ["withdraw_submission"],
    });
  });

  it("a void invoice needs no payments.void: a managing editor withdraws", async () => {
    const { db } = withdrawDb([{ id: "p-void", submission_id: SUBMISSION, status: "void" }]);
    expect({
      answer: await withdraw(actor(["managing_editor"]), db, {
        id: SUBMISSION,
        reason: REASON_TEXT,
      }),
      rpc: rpcNames(db),
    }).toEqual({ answer: { workflow_state: "Withdrawn" }, rpc: ["withdraw_submission"] });
  });

  it("refuses an agent with 403 human_only before any database call", async () => {
    const { db } = withdrawDb();
    const agent: AdminActor = { ...actor(["admin"]), kind: "agent", scopes: ["submissions"] };
    expect({
      answer: await outcome(withdraw(agent, db, { id: SUBMISSION, reason: REASON_TEXT })),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "human_only" }, calls: 0 });
  });

  it("a reason under 3 characters answers 422 and asks the database nothing", async () => {
    const { db } = withdrawDb();
    const deps: AdminDeps = {
      db: () => db,
      requireActor: () =>
        Promise.resolve({
          userId: "00000000-0000-4000-8000-000000000001",
          kind: "human",
          roles: ["admin"],
          scopes: [],
        }),
      verifyCsrf: () => Promise.resolve(),
      assertSessionFresh: () => undefined,
      requireRecentAuth: () => undefined,
    };
    const route = defineAdminRoute(
      {
        method: "POST",
        action: "submissions.withdraw",
        input: withdrawInputSchema,
        handler: (ctx, input) => withdraw(ctx.actor, ctx.db, input),
      },
      deps,
    );
    const response = await route({
      request: new Request(`https://example.test/api/admin/submissions/${SUBMISSION}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: " ab " }),
      }),
      context: { requestId: "req-wd" },
      params: { id: SUBMISSION },
    });
    expect({ status: response.status, calls: db.calls.length }).toEqual({ status: 422, calls: 0 });
  });
});
