import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as decisionsRoute } from "../../src/routes/api/admin/workforce.memory.decisions";
import { Route as versionRoute } from "../../src/routes/api/admin/workforce.memory.instructions.$id";
import { Route as versionsRoute } from "../../src/routes/api/admin/workforce.memory.instructions";
import { Route as lessonsRoute } from "../../src/routes/api/admin/workforce.memory.lessons";
import type { Actor } from "../../src/server/lib/actor";
import { setDbForTests, type Db } from "../../src/server/lib/db";
import {
  instructionText,
  listDecisions,
  listInstructionVersions,
  listLessons,
} from "../../src/server/workforce/service";

// W7 item 4: the team's memory, read only: `GET /api/admin/workforce/memory/*` through the route files and
// `defineAdminRoute`, and the four service functions behind them. The actor comes from a stand-in `requireActor`.

const live = vi.hoisted(() => {
  const state: { actor?: Actor } = {};
  return state;
});

vi.mock(import("../../src/server/lib/actor.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireActor: () => {
    if (live.actor === undefined) throw new Error("no actor set");
    return Promise.resolve(live.actor);
  },
}));

const USER = "6b2e0a00-0000-4000-8000-0000000000a1";
const CHIEF = "11111111-1111-4111-8111-111111111111";
const SOCIAL = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";
const VERSION = "a0000000-0000-4000-8000-000000000001";

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
  limit: number[];
  eq: unknown[][];
}

/** A client whose every select answers the rows of its table and records what the service asked. */
function memoryDb(rows: Rows): Db & { seen: Seen[] } {
  const seen: Seen[] = [];
  const from = (table: string) => ({
    select: (columns: string) => {
      const call: Seen = { table, select: columns, limit: [], eq: [] };
      seen.push(call);
      const query = {
        order: () => query,
        eq: (...args: unknown[]) => {
          call.eq.push(args);
          return query;
        },
        limit: (take: number) => {
          call.limit.push(take);
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: rows[table]?.[0] ?? null, error: null }),
        // `await query` reads the table: the service ends each list chain by awaiting it.
        then: (resolve: (answer: { data: object[]; error: null }) => unknown) =>
          resolve({ data: rows[table] ?? [], error: null }),
      };
      return query;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client with the one member the service reads through
  return Object.assign({ from } as unknown as Db, { seen });
}

const team = [
  { id: CHIEF, slug: "chief", name: "Ada Chief" },
  { id: SOCIAL, slug: "social", name: "Maya Okafor" },
];

const decisionRow = (id: string, over: object = {}) => ({
  id,
  meeting_on: "2026-10-15",
  owner_id: SOCIAL,
  decision: "Post two reels a week",
  due_on: "2026-10-22",
  metric: "Two reels approved",
  status: "open",
  checked_at: null,
  ...over,
});

const D1 = "d0000000-0000-4000-8000-000000000001";
const D2 = "d0000000-0000-4000-8000-000000000002";
const L1 = "e0000000-0000-4000-8000-000000000001";
const L2 = "e0000000-0000-4000-8000-000000000002";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

async function get(route: unknown, path: string, actor: Actor, db: Db, params = {}) {
  const get = field(field(field(route, "options"), "server"), "handlers");
  const handler = field(get, "GET");
  if (typeof handler !== "function") throw new Error("no GET handler");
  live.actor = actor;
  setDbForTests(db);
  const answer: unknown = await Reflect.apply(handler, undefined, [
    {
      request: new Request(`https://example.test${path}`, { method: "GET" }),
      context: { requestId: "req-memory" },
      params,
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

describe("the team's memory: who may read it", () => {
  it("refuses an agent key without the workforce scope with 403 on each route, and reads nothing", async () => {
    const db = memoryDb({});
    const base = "/api/admin/workforce/memory";
    const statuses = [
      (await get(decisionsRoute, `${base}/decisions`, outOfScope, db)).status,
      (await get(lessonsRoute, `${base}/lessons`, outOfScope, db)).status,
      (await get(versionsRoute, `${base}/instructions`, outOfScope, db)).status,
      (await get(versionRoute, `${base}/instructions/${VERSION}`, outOfScope, db, { id: VERSION }))
        .status,
    ];
    expect({ statuses, reads: db.seen }).toEqual({ statuses: [403, 403, 403, 403], reads: [] });
  });

  it("refuses the decisions service itself to an actor the matrix does not allow, before any read", async () => {
    const db = memoryDb({});
    await expect(listDecisions({ ...outOfScope, requestId: "r" }, db)).rejects.toMatchObject({
      code: "out_of_scope",
    });
    expect(db.seen).toEqual([]);
  });

  it("refuses the lessons service itself to an actor the matrix does not allow, before any read", async () => {
    const db = memoryDb({});
    await expect(listLessons({ ...outOfScope, requestId: "r" }, db)).rejects.toMatchObject({
      code: "out_of_scope",
    });
    expect(db.seen).toEqual([]);
  });

  it("refuses the instruction history service itself to an actor the matrix does not allow, before any read", async () => {
    const db = memoryDb({});
    await expect(
      listInstructionVersions({ ...outOfScope, requestId: "r" }, db),
    ).rejects.toMatchObject({ code: "out_of_scope" });
    expect(db.seen).toEqual([]);
  });

  it("refuses the text of a version to an actor the matrix does not allow, before any read", async () => {
    const db = memoryDb({});
    await expect(
      instructionText({ ...outOfScope, requestId: "r" }, db, VERSION),
    ).rejects.toMatchObject({ code: "out_of_scope" });
    expect(db.seen).toEqual([]);
  });
});

describe("GET /api/admin/workforce/memory/decisions", () => {
  it("names each decision's owner and keeps its status, due date and metric", async () => {
    const db = memoryDb({
      agents: team,
      agent_decisions: [
        decisionRow(D1),
        decisionRow(D2, { owner_id: CHIEF, status: "missed", checked_at: "2026-10-23T08:00:00Z" }),
      ],
    });
    const answer = await get(decisionsRoute, "/api/admin/workforce/memory/decisions", person, db);
    expect(answer.body).toEqual({
      items: [
        {
          id: D1,
          meeting_on: "2026-10-15",
          owner_slug: "social",
          owner_name: "Maya Okafor",
          decision: "Post two reels a week",
          due_on: "2026-10-22",
          metric: "Two reels approved",
          status: "open",
          checked_at: null,
        },
        {
          id: D2,
          meeting_on: "2026-10-15",
          owner_slug: "chief",
          owner_name: "Ada Chief",
          decision: "Post two reels a week",
          due_on: "2026-10-22",
          metric: "Two reels approved",
          status: "missed",
          checked_at: "2026-10-23T08:00:00Z",
        },
      ],
    });
  });

  it("calls a decision whose owner is gone by a plain name and reads an unknown status as open", async () => {
    const db = memoryDb({
      agents: team,
      agent_decisions: [decisionRow(D1, { owner_id: GONE, status: "postponed" })],
    });
    const answer = await get(decisionsRoute, "/api/admin/workforce/memory/decisions", person, db);
    expect(field(field(answer.body, "items"), "0")).toMatchObject({
      owner_slug: "",
      owner_name: "A colleague who left",
      status: "open",
    });
  });

  it("asks for the 200 newest decisions", async () => {
    const db = memoryDb({ agents: team, agent_decisions: [] });
    await get(decisionsRoute, "/api/admin/workforce/memory/decisions", person, db);
    expect(db.seen.find((call) => call.table === "agent_decisions")?.limit).toEqual([200]);
  });
});

describe("GET /api/admin/workforce/memory/lessons", () => {
  const lesson = (id: string, over: object = {}) => ({
    id,
    agent_id: SOCIAL,
    trigger: "A caption opens with a question",
    action: "Open with the place",
    evidence_ref: "approval:abc",
    source: "decline",
    status: "active",
    uses: 4,
    last_used_at: "2026-10-14T09:00:00Z",
    created_at: "2026-10-10T09:00:00Z",
    ...over,
  });

  it("names whose a lesson is, and leaves the name empty for one taught to the whole team", async () => {
    const db = memoryDb({
      agents: team,
      agent_lessons: [
        lesson(L1),
        lesson(L2, { agent_id: null, source: "matter", uses: 0, last_used_at: null }),
      ],
    });
    const answer = await get(lessonsRoute, "/api/admin/workforce/memory/lessons", person, db);
    expect(answer.body).toEqual({
      items: [
        {
          id: L1,
          agent_slug: "social",
          agent_name: "Maya Okafor",
          trigger: "A caption opens with a question",
          action: "Open with the place",
          source: "decline",
          status: "active",
          uses: 4,
          last_used_at: "2026-10-14T09:00:00Z",
          created_at: "2026-10-10T09:00:00Z",
        },
        {
          id: L2,
          agent_slug: null,
          agent_name: null,
          trigger: "A caption opens with a question",
          action: "Open with the place",
          source: "matter",
          status: "active",
          uses: 0,
          last_used_at: null,
          created_at: "2026-10-10T09:00:00Z",
        },
      ],
    });
  });

  it("reads an unknown status as active and asks for the 200 newest lessons", async () => {
    const db = memoryDb({ agents: team, agent_lessons: [lesson(L1, { status: "shelved" })] });
    const answer = await get(lessonsRoute, "/api/admin/workforce/memory/lessons", person, db);
    const call = db.seen.find((seen) => seen.table === "agent_lessons");
    expect({
      status: field(field(field(answer.body, "items"), "0"), "status"),
      limit: call?.limit,
    }).toEqual({ status: "active", limit: [200] });
  });
});

describe("GET /api/admin/workforce/memory/instructions", () => {
  const version = (id: string, over: object = {}) => ({
    id,
    agent_id: SOCIAL,
    version: 2,
    instructions: "Write like a person.",
    reason: "Declined twice for sounding formal",
    approval_id: null,
    created_at: "2026-10-12T09:00:00Z",
    ...over,
  });

  it("lists each version with its colleague, reason and date, and never its text", async () => {
    const db = memoryDb({
      agents: team,
      agent_instruction_versions: [
        version(VERSION),
        version("a0000000-0000-4000-8000-000000000002", { agent_id: GONE, version: 1 }),
      ],
    });
    const answer = await get(versionsRoute, "/api/admin/workforce/memory/instructions", person, db);
    const call = db.seen.find((seen) => seen.table === "agent_instruction_versions");
    expect({
      body: answer.body,
      selectsText: call?.select.split(", ").includes("instructions"),
      limit: call?.limit,
    }).toEqual({
      body: {
        items: [
          {
            id: VERSION,
            agent_slug: "social",
            agent_name: "Maya Okafor",
            version: 2,
            reason: "Declined twice for sounding formal",
            approval_id: null,
            created_at: "2026-10-12T09:00:00Z",
          },
          {
            id: "a0000000-0000-4000-8000-000000000002",
            agent_slug: "",
            agent_name: "A colleague who left",
            version: 1,
            reason: "Declined twice for sounding formal",
            approval_id: null,
            created_at: "2026-10-12T09:00:00Z",
          },
        ],
      },
      selectsText: false,
      limit: [200],
    });
  });
});

describe("GET /api/admin/workforce/memory/instructions/:id", () => {
  const path = `/api/admin/workforce/memory/instructions/${VERSION}`;

  it("answers the text of that one version as data, unchanged", async () => {
    const text = "Write like a person.\n<script>alert(1)</script>";
    const db = memoryDb({ agent_instruction_versions: [{ id: VERSION, instructions: text }] });
    const answer = await get(versionRoute, path, person, db, { id: VERSION });
    const call = db.seen[0];
    expect({ body: answer.body, select: call?.select, eq: call?.eq }).toEqual({
      body: { id: VERSION, instructions: text },
      select: "id, instructions",
      eq: [["id", VERSION]],
    });
  });

  it("answers 404 when the version does not exist", async () => {
    const db = memoryDb({ agent_instruction_versions: [] });
    const answer = await get(versionRoute, path, person, db, { id: VERSION });
    expect(answer.status).toBe(404);
  });

  it("refuses an id that is not a uuid with 422 and reads nothing", async () => {
    const db = memoryDb({});
    const answer = await get(
      versionRoute,
      "/api/admin/workforce/memory/instructions/x",
      person,
      db,
      {
        id: "x",
      },
    );
    expect({ status: answer.status, reads: db.seen }).toEqual({ status: 422, reads: [] });
  });
});
