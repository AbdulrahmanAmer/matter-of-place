import "../../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../../../src/routes/api/admin/jobs.events";
import type { Actor } from "../../../src/server/lib/actor";
import { setDbForTests, type Db } from "../../../src/server/lib/db";
import { listEvents } from "../../../src/server/jobs/events";

// W7 item 5: `GET /api/admin/jobs/events` through the route file and `defineAdminRoute`. The actor comes from a
// stand-in `requireActor`, so each case shows what the matrix and the service do with that actor.

const live = vi.hoisted(() => {
  const state: { actor?: Actor } = {};
  return state;
});

vi.mock(import("../../../src/server/lib/actor.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireActor: () => {
    if (live.actor === undefined) throw new Error("no actor set");
    return Promise.resolve(live.actor);
  },
}));

const USER = "6b2e0a00-0000-4000-8000-0000000000a1";
const PROPERTY = "3f2a9c1d-0000-4000-8000-000000000001";
const planned = "e0000000-0000-4000-8000-000000000001";
const untaken = "e0000000-0000-4000-8000-000000000002";
const waiting = "e0000000-0000-4000-8000-000000000003";
const stuck = "e0000000-0000-4000-8000-000000000004";
const RECIPE = "c0000000-0000-4000-8000-000000000001";
const GONE_RECIPE = "c0000000-0000-4000-8000-000000000002";

const person: Actor = { userId: USER, kind: "human", roles: ["media_ops"], scopes: [] };
const outOfScope: Actor = {
  userId: USER,
  kind: "agent",
  roles: ["media_ops"],
  scopes: ["properties"],
};

type Rows = Record<string, object[]>;

interface Seen {
  table: string;
  select: string;
  in: unknown[][];
  not: unknown[][];
  limit: number[];
}

/** A client whose every select answers the rows of its table and records what the service asked. */
function eventsDb(rows: Rows): Db & { seen: Seen[] } {
  const seen: Seen[] = [];
  const from = (table: string) => ({
    select: (columns: string) => {
      const call: Seen = { table, select: columns, in: [], not: [], limit: [] };
      seen.push(call);
      const query = {
        order: () => query,
        in: (...args: unknown[]) => {
          call.in.push(args);
          return query;
        },
        not: (...args: unknown[]) => {
          call.not.push(args);
          return query;
        },
        limit: (take: number) => {
          call.limit.push(take);
          return query;
        },
        // `await query` reads the table: the service ends each chain by awaiting it.
        then: (resolve: (answer: { data: object[]; error: null }) => unknown) =>
          resolve({ data: rows[table] ?? [], error: null }),
      };
      return query;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client with the one member the service reads through
  return Object.assign({ from } as unknown as Db, { seen });
}

const eventRow = (id: string, over: object = {}) => ({
  id,
  type: "property.published",
  at: "2026-10-15T10:00:00Z",
  entity: "property",
  entity_id: PROPERTY,
  processed_at: "2026-10-15T10:00:02Z",
  ...over,
});

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

async function get(actor: Actor, db: Db) {
  const handle = field(field(field(Route, "options"), "server"), "handlers");
  const get = field(handle, "GET");
  if (typeof get !== "function") throw new Error("no GET handler");
  live.actor = actor;
  setDbForTests(db);
  const answer: unknown = await Reflect.apply(get, undefined, [
    {
      request: new Request("https://example.test/api/admin/jobs/events", { method: "GET" }),
      context: { requestId: "req-events" },
      params: {},
    },
  ]);
  if (!(answer instanceof Response)) throw new Error("the route answered nothing");
  const body: unknown = await answer.json();
  return { status: answer.status, body };
}

afterEach(() => {
  setDbForTests(undefined);
  delete live.actor;
});

describe("GET /api/admin/jobs/events", () => {
  it("refuses an agent key without the jobs scope with 403 and reads nothing", async () => {
    const db = eventsDb({});
    const answer = await get(outOfScope, db);
    expect({ status: answer.status, reads: db.seen }).toEqual({ status: 403, reads: [] });
  });

  it("refuses the service itself to an actor the matrix does not allow, before any read", async () => {
    const db = eventsDb({});
    await expect(listEvents({ ...outOfScope, requestId: "req-events" }, db)).rejects.toMatchObject({
      code: "out_of_scope",
    });
    expect(db.seen).toEqual([]);
  });

  it("names each recipe once for an event and marks an event no job took", async () => {
    const db = eventsDb({
      events: [
        eventRow(planned),
        eventRow(untaken, { type: "inquiry.created", entity: null, entity_id: null }),
        eventRow(waiting, { processed_at: null }),
      ],
      jobs: [
        { event_id: planned, recipe_id: RECIPE },
        { event_id: planned, recipe_id: RECIPE },
        { event_id: planned, recipe_id: GONE_RECIPE },
      ],
      automation_recipes: [{ id: RECIPE, name: "Property published" }],
      event_fanout_failures: [],
    });
    const answer = await get(person, db);
    expect(answer.body).toEqual({
      events: [
        {
          id: planned,
          type: "property.published",
          at: "2026-10-15T10:00:00Z",
          entity: "property",
          entity_id: PROPERTY,
          processed: true,
          recipes: [
            { id: RECIPE, name: "Property published" },
            { id: GONE_RECIPE, name: "A recipe that no longer exists" },
          ],
        },
        {
          id: untaken,
          type: "inquiry.created",
          at: "2026-10-15T10:00:00Z",
          entity: null,
          entity_id: null,
          processed: true,
          recipes: [],
        },
        {
          id: waiting,
          type: "property.published",
          at: "2026-10-15T10:00:00Z",
          entity: "property",
          entity_id: PROPERTY,
          processed: false,
          recipes: [],
        },
      ],
      failures: [],
    });
  });

  it("asks for the 50 newest events, only the jobs of those events, and never a payload", async () => {
    const db = eventsDb({
      events: [eventRow(planned)],
      jobs: [],
      event_fanout_failures: [],
    });
    await get(person, db);
    const [events, jobs] = db.seen;
    expect({
      eventLimit: events?.limit,
      eventColumns: events?.select.split(", ").includes("payload"),
      jobIn: jobs?.in,
      jobNot: jobs?.not,
      everyColumnList: db.seen.map((call) => call.select.includes("payload")),
    }).toEqual({
      eventLimit: [50],
      eventColumns: false,
      jobIn: [["event_id", [planned]]],
      jobNot: [["recipe_id", "is", null]],
      everyColumnList: [false, false, false],
    });
  });

  it("lists an event that failed to plan with its attempts, next try and last error", async () => {
    const db = eventsDb({
      events: [],
      event_fanout_failures: [
        {
          event_id: stuck,
          attempts: 3,
          next_at: "2026-10-15T11:00:00Z",
          last_error: "no_recipe_matched",
          events: {
            type: "submission.created",
            at: "2026-10-15T09:00:00Z",
            entity: "submission",
            entity_id: PROPERTY,
          },
        },
      ],
    });
    const answer = await get(person, db);
    expect(answer.body).toEqual({
      events: [],
      failures: [
        {
          event_id: stuck,
          type: "submission.created",
          at: "2026-10-15T09:00:00Z",
          entity: "submission",
          entity_id: PROPERTY,
          attempts: 3,
          next_at: "2026-10-15T11:00:00Z",
          last_error: "no_recipe_matched",
        },
      ],
    });
  });
});
