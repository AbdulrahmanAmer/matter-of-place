import "../../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as approveRoute } from "../../../src/routes/api/admin/jobs.$id.approve";
import { Route as cancelRoute } from "../../../src/routes/api/admin/jobs.$id.cancel";
import { Route as retryRoute } from "../../../src/routes/api/admin/jobs.$id.retry";
import { Route as listRoute } from "../../../src/routes/api/admin/jobs.index";
import { Route as retryBulkRoute } from "../../../src/routes/api/admin/jobs.retry-bulk";
import type { Actor } from "../../../src/server/lib/actor";
import { setDbForTests } from "../../../src/server/lib/db";
import { entityJobsFilter } from "../../../src/server/lib/jobs";
import { fakeDb, type FakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

// B8 step 9: screen 16's API through the route files and `defineAdminRoute` (API-02). The actor comes from a stand-in
// `requireActor` and CSRF passes, so each case shows what the matrix, the parse and the service do with that actor.

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
vi.mock(import("../../../src/server/lib/csrf.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  verifyCsrf: () => Promise.resolve(),
}));

const JOB = "6b2e0a00-0000-4000-8000-0000000000f1";
const USER = "6b2e0a00-0000-4000-8000-0000000000a1";
const PROPERTY = "3f2a9c1d-0000-4000-8000-000000000001";

const person = (roles: Actor["roles"]): Actor => ({
  userId: USER,
  kind: "human",
  roles,
  scopes: [],
});
const agentKey: Actor = { userId: USER, kind: "agent", roles: ["media_ops"], scopes: ["jobs"] };

/** One select of `jobs` as the service builds it: what it passed to `.or` and to `.limit`. */
interface Select {
  table: string;
  or: string[];
  limit: number[];
}

/** `fakeDb` with a `from` that answers the list's filter chain (P-905) and records each select. */
function jobsDb(rows: object[], rpc: FakeDbOptions["rpc"] = {}): FakeDb & { selects: Select[] } {
  const db = fakeDb({ rpc });
  const selects: Select[] = [];
  return Object.assign(db, {
    selects,
    from: (table: string) => {
      db.calls.push({ kind: "from", name: table, args: [] });
      const seen: Select = { table, or: [], limit: [] };
      selects.push(seen);
      const query = {
        eq: () => query,
        lt: () => query,
        ilike: () => query,
        order: () => query,
        or: (text: string) => {
          seen.or.push(text);
          return query;
        },
        limit: (take: number) => {
          seen.limit.push(take);
          return Promise.resolve({ data: rows.slice(0, take), error: null });
        },
      };
      return { select: () => query };
    },
  });
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

/** Calls the route file's own handler as the router would. */
async function send(
  route: unknown,
  actor: Actor,
  db: FakeDb,
  request: { method: "GET" | "POST"; url: string; params?: Record<string, string>; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const handle = field(field(field(field(route, "options"), "server"), "handlers"), request.method);
  if (typeof handle !== "function") throw new Error(`no ${request.method} handler`);
  live.actor = actor;
  setDbForTests(db);
  const init: RequestInit =
    request.body === undefined
      ? { method: request.method }
      : {
          method: request.method,
          body: JSON.stringify(request.body),
          headers: { "content-type": "application/json" },
        };
  const answer: unknown = await Reflect.apply(handle, undefined, [
    {
      request: new Request(`https://example.test/api/admin/jobs${request.url}`, init),
      context: { requestId: "req-jobs" },
      params: request.params ?? {},
    },
  ]);
  if (!(answer instanceof Response)) throw new Error("the route answered nothing");
  return { status: answer.status, body: await answer.json() };
}

const post = (route: unknown, actor: Actor, db: FakeDb, body?: unknown) =>
  send(route, actor, db, {
    method: "POST",
    url: `/${JOB}`,
    params: { id: JOB },
    ...(body === undefined ? {} : { body }),
  });

const list = (actor: Actor, db: FakeDb, query: string) =>
  send(listRoute, actor, db, { method: "GET", url: query });

const codeOf = (body: unknown): unknown => field(field(body, "error"), "code");

function jobRow(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    type: "send_email",
    status: "dead",
    created_at: new Date(Date.UTC(2026, 9, 1) - n * 60_000).toISOString(),
  };
}

afterEach(() => {
  setDbForTests(undefined);
  delete live.actor;
});

describe("job actions through defineAdminRoute", () => {
  it("refuses commercial a retry with 403 forbidden and calls nothing", async () => {
    const db = fakeDb({ rpc: { admin_retry_job: () => undefined } });
    const answer = await post(retryRoute, person(["commercial"]), db);
    expect({ status: answer.status, code: codeOf(answer.body), calls: db.calls }).toEqual({
      status: 403,
      code: "forbidden",
      calls: [],
    });
  });

  it("lets media_ops retry a dead job, which the database queues again", async () => {
    const states = new Map([[JOB, "dead"]]);
    const db = fakeDb({
      rpc: {
        admin_retry_job: (args) => {
          states.set(args.p_job_id, "queued");
          return undefined;
        },
      },
    });
    const answer = await post(retryRoute, person(["media_ops"]), db);
    expect({ status: answer.status, body: answer.body, state: states.get(JOB) }).toEqual({
      status: 200,
      body: { id: JOB, status: "queued" },
      state: "queued",
    });
  });

  it("lets an agent key scoped to jobs retry, audited as the agent", async () => {
    const db = fakeDb({ rpc: { admin_retry_job: () => undefined } });
    const answer = await post(retryRoute, agentKey, db);
    expect({ status: answer.status, calls: db.calls }).toEqual({
      status: 200,
      calls: [
        {
          kind: "rpc",
          name: "admin_retry_job",
          args: [{ p_job_id: JOB, p_actor: USER, p_actor_kind: "agent", p_request_id: "req-jobs" }],
        },
      ],
    });
  });

  it("refuses an agent key an approve and a retry-bulk with 403 human_only and calls nothing", async () => {
    const db = fakeDb({
      rpc: { admin_approve_job: () => undefined, admin_retry_jobs: () => 1 },
    });
    const approve = await post(approveRoute, agentKey, db);
    const bulk = await send(retryBulkRoute, agentKey, db, {
      method: "POST",
      url: "/retry-bulk",
      body: { type: "send_email" },
    });
    expect({
      approve: [approve.status, codeOf(approve.body)],
      bulk: [bulk.status, codeOf(bulk.body)],
      calls: db.calls,
    }).toEqual({ approve: [403, "human_only"], bulk: [403, "human_only"], calls: [] });
  });

  it("makes exactly one RPC for each of retry, cancel and approve, and no other call", async () => {
    const answers = [];
    for (const [route, fn] of [
      [retryRoute, "admin_retry_job"],
      [cancelRoute, "admin_cancel_job"],
      [approveRoute, "admin_approve_job"],
    ] as const) {
      const db = fakeDb({ rpc: { [fn]: () => undefined } });
      const answer = await post(route, person(["admin"]), db);
      answers.push([answer.status, db.calls.map((call) => `${call.kind} ${call.name}`)]);
    }
    expect(answers).toEqual([
      [200, ["rpc admin_retry_job"]],
      [200, ["rpc admin_cancel_job"]],
      [200, ["rpc admin_approve_job"]],
    ]);
  });

  it("retries every matching dead job with one admin_retry_jobs RPC and answers the count", async () => {
    const db = fakeDb({ rpc: { admin_retry_jobs: () => 3 } });
    const answer = await send(retryBulkRoute, person(["media_ops"]), db, {
      method: "POST",
      url: "/retry-bulk",
      body: { type: "send_email", error_like: "%timeout%" },
    });
    expect({ status: answer.status, body: answer.body, calls: db.calls }).toEqual({
      status: 200,
      body: { count: 3 },
      calls: [
        {
          kind: "rpc",
          name: "admin_retry_jobs",
          args: [
            {
              p_actor: USER,
              p_actor_kind: "human",
              p_request_id: "req-jobs",
              p_type: "send_email",
              p_error_like: "%timeout%",
            },
          ],
        },
      ],
    });
  });

  it("refuses a retry-bulk with no filter, or a since with an offset, with 422 and calls nothing", async () => {
    const db = fakeDb({ rpc: { admin_retry_jobs: () => 0 } });
    const bulk = (body: unknown) =>
      send(retryBulkRoute, person(["admin"]), db, { method: "POST", url: "/retry-bulk", body });
    const empty = await bulk({});
    const offset = await bulk({ since: "2026-10-01T00:00:00+02:00" });
    expect([empty.status, offset.status, db.calls]).toEqual([422, 422, []]);
  });
});

describe("listJobs through defineAdminRoute", () => {
  it("refuses limit=51 with 422 and asks the database nothing", async () => {
    const db = jobsDb([]);
    const answer = await list(person(["commercial"]), db, "?limit=51");
    expect({ status: answer.status, calls: db.calls }).toEqual({ status: 422, calls: [] });
  });

  it("answers 50 of 51 matching rows and a cursor to the next page, as B6's lists do", async () => {
    const rows = Array.from({ length: 51 }, (_, n) => jobRow(n + 1));
    const db = jobsDb(rows);
    const answer = await list(person(["commercial"]), db, "?dead_only=true");
    const items = field(answer.body, "items");
    expect({
      status: answer.status,
      rows: Array.isArray(items) ? items.length : items,
      next: field(answer.body, "next_cursor"),
      limits: db.selects.map((select) => select.limit),
    }).toEqual({
      status: 200,
      rows: 50,
      next: `${jobRow(50).created_at}~${jobRow(50).id}`,
      limits: [[51]],
    });
  });

  it("passes entityJobsFilter(<uuid>) to .or exactly once in its one select", async () => {
    const db = jobsDb([jobRow(1)]);
    const answer = await list(person(["media_ops"]), db, `?entity=${PROPERTY}`);
    expect({ status: answer.status, selects: db.selects }).toEqual({
      status: 200,
      selects: [{ table: "jobs", or: [entityJobsFilter(PROPERTY)], limit: [51] }],
    });
  });

  it("refuses entity=abc with 422 and asks the database nothing", async () => {
    const db = jobsDb([]);
    const answer = await list(person(["media_ops"]), db, "?entity=abc");
    expect({ status: answer.status, code: codeOf(answer.body), calls: db.calls }).toEqual({
      status: 422,
      code: "validation",
      calls: [],
    });
  });
});
