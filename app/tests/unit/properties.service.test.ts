import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src/db";
import { unpublishInputSchema, type PropertyDetail } from "../../src/domain/admin-properties";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { verifyPreview } from "../../src/server/lib/preview-token";
import { getDraftProperty } from "../../src/server/previews/service";
import {
  createFromSubmission,
  getProperty,
  issueAgentPreview,
  issuePreviewToken,
  listProperties,
  listRepresentatives,
  publishProperty,
  putRepresentative,
  revokePreviews,
  setFeatures,
  setRanks,
  unpublishProperty,
  updateProperty,
} from "../../src/server/properties/service";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { withTables, type Row } from "../fixtures/table-stub";

// Screens 7 and 8 (B7 steps 7 and 7a): who may read and write a property, what each write sends, and what a refused write
// answers. The SQL behind each RPC is proved in tests/db/admin.db.test.ts.

const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
const COPY_JOB = "00000000-0000-4000-8000-0000000000d1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";

const actor = (roles: AdminActor["roles"], kind: AdminActor["kind"] = "human"): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind,
  roles,
  scopes: kind === "agent" ? ["properties"] : [],
  requestId: "req-props",
});

const editor = actor(["managing_editor"]);

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

const sqlError = (message: string, code: string) => Object.assign(new Error(message), { code });

const rpcNames = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

const complete: PropertyDetail = {
  property: {
    id: PROPERTY,
    slug: "san-francisco-00000000",
    title: "A House Above the Water",
    market_slug: "california",
    region_slug: "bay-area",
    city: "San Francisco",
    neighborhood: "Sea Cliff",
    state: "California",
    country: "United States",
    address: "1 Fixture Lane",
    price: 4_200_000,
    beds: 4,
    baths: 3.5,
    interior_sq_ft: 3400,
    lot_acres: 0.3,
    year_built: 1931,
    type: "Residence",
    style: "Mediterranean",
    architect: null,
    designer: null,
    status: "Active",
    story: ["One.", "Two."],
    place: "Above the water.",
    representative_id: null,
    presented_by_owner: true,
    listing_url: null,
    hero_rank: null,
    featured_rank: null,
    hero_image: "o/sea-cliff/1-0a1b2c3d.webp",
    campaign_tier: "Feature",
    source: "Submission",
    submission_id: SUBMISSION,
    editorial_state: "review",
    published_at: null,
    first_published_at: null,
    taken_down_at: null,
    updated_at: "2026-10-07T12:00:00Z",
    version: 3,
  },
  media: [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `00000000-0000-4000-8000-00000000010${String(n)}`,
    media_key: `o/sea-cliff/${String(n)}-0a1b2c3d.webp`,
    staging_path: null,
    alt: `Room ${String(n)}`,
    orientation: "landscape",
    sort_order: n,
  })),
  features: [],
  related: [],
  representative: null,
  submission: { id: SUBMISSION, workflow_state: "Scheduled", submitter_kind: "owner" },
};

/** `PropertyDetail` as the JSON the RPC returns. */
const asJson = (detail: PropertyDetail): Json => detail;

describe("listProperties", () => {
  it("asks list_properties for one row more than a page and names the next page by its last row", async () => {
    const rows = Array.from({ length: 3 }, (_, n) => ({
      id: `00000000-0000-4000-8000-00000000020${String(n)}`,
      slug: `p-${String(n)}`,
      title: `Property ${String(n)}`,
      market_slug: "california",
      region_slug: "bay-area",
      editorial_state: "draft" as const,
      campaign_tier: "Editorial" as const,
      hero_rank: 0,
      featured_rank: 0,
      published_at: "",
      source: "Submission" as const,
      updated_at: `2026-10-07T12:00:0${String(n)}Z`,
    }));
    const db = fakeDb({ rpc: { list_properties: () => rows } });
    const page = await listProperties(actor(["commercial"]), db, {
      limit: 2,
      editorial_state: "draft",
    });
    expect({ args: db.calls[0]?.args[0], ids: page.items.length, next: page.next_cursor }).toEqual({
      args: { p_limit: 3, p_states: ["draft"] },
      ids: 2,
      next: `2026-10-07T12:00:01Z~${rows[1]?.id ?? ""}`,
    });
  });

  it("refuses a cursor it did not write with 422 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(listProperties(editor, db, { limit: 50, cursor: "nonsense" })),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 422, code: "validation" }, calls: 0 });
  });
});

describe("getProperty", () => {
  it("answers the detail of one property_detail call, and 404 when there is none", async () => {
    const found = fakeDb({ rpc: { property_detail: () => asJson(complete) } });
    expect((await getProperty(actor(["media_ops"]), found, PROPERTY)).property.version).toBe(3);
    const missing = fakeDb({ rpc: { property_detail: () => null } });
    expect(await outcome(getProperty(editor, missing, PROPERTY))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});

describe("createFromSubmission", () => {
  it("returns the RPC's property_id and copy_job_id with no Storage and no enqueueJob call, the same on a second call", async () => {
    const db = fakeDb({
      rpc: {
        create_property_from_submission: () => ({ property_id: PROPERTY, copy_job_id: COPY_JOB }),
      },
    });
    const first = await createFromSubmission(actor(["visual_editor"]), db, SUBMISSION);
    const second = await createFromSubmission(actor(["visual_editor"]), db, SUBMISSION);
    expect({ first, second, calls: rpcNames(db) }).toEqual({
      first: { property_id: PROPERTY, copy_job_id: COPY_JOB },
      second: { property_id: PROPERTY, copy_job_id: COPY_JOB },
      calls: ["rpc:create_property_from_submission", "rpc:create_property_from_submission"],
    });
  });

  it("refuses media ops with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(createFromSubmission(actor(["media_ops"]), db, SUBMISSION)),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});

/** `update_property` as B2's save_property behaves: a version check, then exactly one more. */
function versionedDb() {
  const row = { version: 3, title: "Before" };
  const db = fakeDb({
    rpc: {
      update_property: (args) => {
        if (args.p_expected_version !== row.version) return sqlError("version_conflict", "40001");
        Object.assign(row, args.p_patch, { version: row.version + 1 });
        return row.version;
      },
    },
  });
  return { db, row };
}

describe("updateProperty", () => {
  it("a fresh expected_version answers version + 1", async () => {
    const { db } = versionedDb();
    expect(
      await updateProperty(editor, db, {
        id: PROPERTY,
        expected_version: 3,
        patch: { title: "After" },
      }),
    ).toEqual({ version: 4 });
  });

  it("a stale expected_version is 409 stale", async () => {
    const { db } = versionedDb();
    expect(
      await outcome(
        updateProperty(editor, db, { id: PROPERTY, expected_version: 2, patch: { title: "Late" } }),
      ),
    ).toEqual({ status: 409, code: "stale" });
  });

  it("two sessions that read version 3 save one after the other: the second is refused", async () => {
    const { db, row } = versionedDb();
    const first = await outcome(
      updateProperty(editor, db, { id: PROPERTY, expected_version: 3, patch: { title: "One" } }),
    );
    const second = await outcome(
      updateProperty(actor(["chief_editor"]), db, {
        id: PROPERTY,
        expected_version: 3,
        patch: { title: "Two" },
      }),
    );
    expect({ first, second, title: row.title }).toEqual({
      first: { version: 4 },
      second: { status: 409, code: "stale" },
      title: "One",
    });
  });
});

/** A publish that the SQL accepts: the event is written, and no recipe plans a job for it here. */
function publishDb(detail: PropertyDetail, publishes: { count: number } = { count: 0 }) {
  return withTables(
    fakeDb({
      rpc: {
        property_detail: () => asJson(detail),
        publish_property: (args) => {
          if (args.p_expected_version !== detail.property.version) {
            return sqlError("version_conflict", "40001");
          }
          publishes.count += 1;
          // The agent's daily cap of assert_agent_daily_cap: five publishes a UTC day (SEC-11).
          if (publishes.count > 5) return sqlError("agent_daily_limit", "P0001");
          return { event_id: EVENT, version: detail.property.version + 2 };
        },
      },
    }),
    {
      events: [{ id: EVENT, type: "property.published", payload: {}, at: "2026-10-07T12:00:00Z" }],
      automation_recipes: [] as Row[],
      jobs: [] as Row[],
    },
  );
}

describe("publishProperty", () => {
  it("publishes a complete property and answers its event, its jobs and the new version", async () => {
    const db = publishDb(complete);
    const answer = await publishProperty(editor, db, { id: PROPERTY, expected_version: 3 });
    expect({
      answer,
      rpc: db.calls.filter((call) => call.kind === "rpc").map((call) => call.name),
    }).toEqual({
      answer: { event_id: EVENT, jobs: [], version: 5 },
      rpc: ["property_detail", "publish_property"],
    });
  });

  it("refuses a property without a hero in TS with 422 publish_incomplete and never calls publish_property", async () => {
    const db = publishDb({ ...complete, property: { ...complete.property, hero_image: null } });
    expect({
      answer: await outcome(publishProperty(editor, db, { id: PROPERTY, expected_version: 3 })),
      rpc: db.calls.map((call) => call.name),
    }).toEqual({ answer: { status: 422, code: "publish_incomplete" }, rpc: ["property_detail"] });
  });

  it("an agent's sixth publish in a UTC day is 429 agent_daily_limit", async () => {
    const publishes = { count: 0 };
    const agent = actor(["chief_editor"], "agent");
    const answers = [];
    for (let n = 0; n < 6; n += 1) {
      answers.push(
        await outcome(
          publishProperty(agent, publishDb(complete, publishes), {
            id: PROPERTY,
            expected_version: 3,
          }),
        ),
      );
    }
    expect(answers.at(-1)).toEqual({ status: 429, code: "agent_daily_limit" });
    expect(answers.slice(0, 5).every((answer) => !("status" in Object(answer)))).toBe(true);
  });

  it("refuses a visual editor with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(
        publishProperty(actor(["visual_editor"]), db, { id: PROPERTY, expected_version: 3 }),
      ),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});

describe("the other writes of the dossier", () => {
  it("setRanks sends the ranks it was given and leaves a cleared one to the default", async () => {
    const db = fakeDb({ rpc: { set_ranks: () => 9 } });
    await setRanks(editor, db, {
      id: PROPERTY,
      expected_version: 8,
      hero_rank: null,
      featured_rank: 2,
    });
    expect(db.calls[0]?.args[0]).toEqual({
      p_property_id: PROPERTY,
      p_expected_version: 8,
      p_actor: "00000000-0000-4000-8000-000000000001",
      p_actor_kind: "human",
      p_request_id: "req-props",
      p_featured_rank: 2,
    });
  });

  it("a rank is the editors' alone: a visual editor is refused", async () => {
    expect(
      await outcome(
        setRanks(actor(["visual_editor"]), fakeDb(), {
          id: PROPERTY,
          expected_version: 1,
          hero_rank: 1,
          featured_rank: null,
        }),
      ),
    ).toEqual({ status: 403, code: "forbidden" });
  });

  it("setFeatures sends the whole list in order and maps a duplicate to 422", async () => {
    const db = fakeDb({
      rpc: {
        set_features: (args) =>
          new Set(args.p_features).size === args.p_features.length
            ? 5
            : sqlError("invalid_key", "P0001"),
      },
    });
    const saved = await setFeatures(editor, db, {
      id: PROPERTY,
      expected_version: 4,
      features: ["Pool", "Garden"],
    });
    const duplicate = await outcome(
      setFeatures(editor, db, { id: PROPERTY, expected_version: 5, features: ["Pool", "Pool"] }),
    );
    expect({ saved, duplicate }).toEqual({
      saved: { version: 5 },
      duplicate: { status: 422, code: "invalid_key" },
    });
  });

  it("putRepresentative inserts without an id and edits with one", async () => {
    const db = fakeDb({ rpc: { upsert_representative: (args) => args.p_id ?? COPY_JOB } });
    const created = await putRepresentative(editor, db, { name: "Ana Agent", brokerage: "Coast" });
    const edited = await putRepresentative(editor, db, {
      id: PROPERTY,
      name: "Ana Agent",
      brokerage: "Coast Two",
    });
    expect({ created, edited, firstHasId: "p_id" in Object(db.calls[0]?.args[0]) }).toEqual({
      created: { id: COPY_JOB },
      edited: { id: PROPERTY },
      firstHasId: false,
    });
  });

  it("listRepresentatives passes the search as a parameter and pages by name", async () => {
    const db = fakeDb({ rpc: { list_representatives: () => [] } });
    const page = await listRepresentatives(actor(["commercial"]), db, { limit: 50, q: "coast" });
    expect({ page, args: db.calls[0]?.args[0] }).toEqual({
      page: { items: [], next_cursor: null },
      args: { p_limit: 51, p_search: "coast" },
    });
  });
});

describe("issuePreviewToken", () => {
  const db = () =>
    fakeDb({
      rpc: {
        preview_property: () => ({
          preview_nonce: "nonce-1",
          property: { slug: "san-francisco-00000000" },
        }),
      },
    });

  it("answers the public page with a 15 minute draft token", async () => {
    const answer = await issuePreviewToken(editor, db(), PROPERTY, "preview-test-key");
    expect(answer.url).toMatch(
      new RegExp(`^/property/san-francisco-00000000\\?preview=${PROPERTY}\\.\\d+\\.[\\w-]{43}$`),
    );
    expect(Date.parse(answer.expires_at) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
  });

  it("answers 503 preview_secret_missing on a Worker without the key", async () => {
    expect(await outcome(issuePreviewToken(editor, db(), PROPERTY, undefined))).toEqual({
      status: 503,
      code: "preview_secret_missing",
    });
  });
});

// Step 7a: unpublish and takedown, the agent's link and its revocation (invariants 13 and 14).

/** An unpublish that the SQL accepts: the event is written, and no recipe plans a job for it here. */
function unpublishDb() {
  return withTables(
    fakeDb({ rpc: { unpublish_property: () => ({ event_id: EVENT, version: 6 }) } }),
    {
      events: [
        { id: EVENT, type: "property.unpublished", payload: {}, at: "2026-10-08T12:00:00Z" },
      ],
      automation_recipes: [] as Row[],
      jobs: [] as Row[],
    },
  );
}

describe("unpublishProperty", () => {
  it("sends the reason, the takedown and the note in one unpublish_property call and answers its event and version", async () => {
    const db = unpublishDb();
    const answer = await unpublishProperty(editor, db, {
      id: PROPERTY,
      reason: "other",
      note: "Sold privately.",
      takedown: true,
    });
    expect({ answer, args: db.calls.find((call) => call.kind === "rpc")?.args[0] }).toEqual({
      answer: { event_id: EVENT, jobs: [], version: 6 },
      args: {
        p_property_id: PROPERTY,
        p_reason: "other",
        p_takedown: true,
        p_actor: "00000000-0000-4000-8000-000000000001",
        p_actor_kind: "human",
        p_request_id: "req-props",
        p_note: "Sold privately.",
      },
    });
  });

  it("unpublish without a reason is 422: the route's schema refuses it, and so does the SQL", async () => {
    const parsed = (input: Record<string, unknown>) =>
      unpublishInputSchema.safeParse({ id: PROPERTY, takedown: false, ...input }).success;
    const db = fakeDb({ rpc: { unpublish_property: () => sqlError("validation", "22023") } });
    expect({
      missing: parsed({}),
      empty: parsed({ reason: "" }),
      otherWithoutNote: parsed({ reason: "other", note: " " }),
      otherWithNote: parsed({ reason: "other", note: "Sold privately." }),
      sql: await outcome(
        unpublishProperty(editor, db, { id: PROPERTY, reason: "owner_request", takedown: false }),
      ),
    }).toEqual({
      missing: false,
      empty: false,
      otherWithoutNote: false,
      otherWithNote: true,
      sql: { status: 422, code: "validation" },
    });
  });

  it("refuses a visual editor an unpublish with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(
        unpublishProperty(actor(["visual_editor"]), db, {
          id: PROPERTY,
          reason: "owner_request",
          takedown: true,
        }),
      ),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});

describe("issueAgentPreview", () => {
  const KEY = "agent-preview-test-key";
  const NONCE = "00000000-0000-4000-8000-0000000000f1";
  const DAY = 24 * 60 * 60 * 1000;
  const issued = () =>
    fakeDb({
      rpc: {
        issue_agent_preview: (args) =>
          args.p_expected_version === 3
            ? { slug: "san-francisco-00000000", preview_nonce: NONCE, version: 4 }
            : sqlError("version_conflict", "40001"),
        preview_property: () => null,
      },
    });
  const tokenOf = (url: string) => decodeURIComponent(url.split("?preview=")[1] ?? "");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a 7 day agent link signed with the nonce issue_agent_preview returned, and the new version", async () => {
    const db = issued();
    const answer = await issueAgentPreview(editor, db, { id: PROPERTY, expected_version: 3 }, KEY);
    const lifetime = Date.parse(answer.expires_at) - Date.now();
    expect({
      url: answer.url.startsWith("/property/san-francisco-00000000?preview="),
      signed: await verifyPreview(KEY, tokenOf(answer.url), NONCE),
      days: Math.round(lifetime / DAY),
      version: answer.version,
      calls: rpcNames(db),
    }).toEqual({
      url: true,
      signed: true,
      days: 7,
      version: 4,
      calls: ["rpc:issue_agent_preview"],
    });
  });

  it("an agent token still opens on day 6 and is refused on day 8 with a faked clock, with no database call", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-08T12:00:00Z") });
    const { url } = await issueAgentPreview(
      editor,
      issued(),
      { id: PROPERTY, expected_version: 3 },
      KEY,
    );
    const open = async (day: number) => {
      vi.setSystemTime(Date.parse("2026-10-08T12:00:00Z") + day * DAY);
      const db = issued();
      return {
        answer: await outcome(getDraftProperty(db, "san-francisco-00000000", tokenOf(url), KEY)),
        calls: db.calls.length,
      };
    };
    // Day 6 reaches the one read of the nonce (this fake has no row, so it is 404 there); day 8 never does.
    expect({ day6: await open(6), day8: await open(8) }).toEqual({
      day6: { answer: { status: 404, code: "not_found" }, calls: 1 },
      day8: { answer: { status: 404, code: "not_found" }, calls: 0 },
    });
  });

  it("a Worker without the key answers 503 before the state moves, and a stale version is 409 stale", async () => {
    const db = issued();
    expect({
      missing: await outcome(
        issueAgentPreview(editor, db, { id: PROPERTY, expected_version: 3 }, undefined),
      ),
      callsWithoutKey: db.calls.length,
      stale: await outcome(
        issueAgentPreview(editor, db, { id: PROPERTY, expected_version: 2 }, KEY),
      ),
    }).toEqual({
      missing: { status: 503, code: "preview_secret_missing" },
      callsWithoutKey: 0,
      stale: { status: 409, code: "stale" },
    });
  });

  it("refuses commercial an agent link with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(
        issueAgentPreview(actor(["commercial"]), db, { id: PROPERTY, expected_version: 3 }, KEY),
      ),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});

describe("revokePreviews", () => {
  it("calls rotate_preview_nonce once and answers the new version", async () => {
    const db = fakeDb({ rpc: { rotate_preview_nonce: () => 8 } });
    expect({
      answer: await revokePreviews(actor(["visual_editor"]), db, PROPERTY),
      calls: rpcNames(db),
      args: db.calls[0]?.args[0],
    }).toEqual({
      answer: { version: 8 },
      calls: ["rpc:rotate_preview_nonce"],
      args: {
        p_property_id: PROPERTY,
        p_actor: "00000000-0000-4000-8000-000000000001",
        p_actor_kind: "human",
        p_request_id: "req-props",
      },
    });
  });

  it("refuses commercial a revocation with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(revokePreviews(actor(["commercial"]), db, PROPERTY)),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });
});
