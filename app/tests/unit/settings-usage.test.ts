import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../../src/routes/api/admin/settings.usage";
import type { Actor } from "../../src/server/lib/actor";
import { setDbForTests } from "../../src/server/lib/db";
import { getUsage } from "../../src/server/settings/usage/service";
import { fakeDb } from "../fixtures/fake-db";

// W7 item 7: `GET /api/admin/settings/usage` through the route file and `defineAdminRoute`, the same matrix action as
// the Settings read. The actor comes from a stand-in `requireActor`.

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

const admin: Actor = { userId: USER, kind: "human", roles: ["admin"], scopes: [] };
const mediaOps: Actor = { userId: USER, kind: "human", roles: ["media_ops"], scopes: [] };
const agent: Actor = { userId: USER, kind: "agent", roles: ["admin"], scopes: ["settings"] };

const AT = "2026-10-15T04:00:00Z";

const row = (line: string, over: object = {}) => ({
  line,
  used: 0,
  limit_value: null,
  note: null,
  measured_at: AT,
  ...over,
});

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

async function get(actor: Actor, db: ReturnType<typeof fakeDb>) {
  const handle = field(field(field(Route, "options"), "server"), "handlers");
  const handler = field(handle, "GET");
  if (typeof handler !== "function") throw new Error("no GET handler");
  live.actor = actor;
  setDbForTests(db);
  const answer: unknown = await Reflect.apply(handler, undefined, [
    {
      request: new Request("https://example.test/api/admin/settings/usage", { method: "GET" }),
      context: { requestId: "req-usage" },
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

describe("GET /api/admin/settings/usage", () => {
  it("refuses a person without the admin role and an agent key with 403 and reads nothing", async () => {
    const db = fakeDb({ tables: { vendor_usage: [row("sentry_errors")] } });
    const answers = [await get(mediaOps, db), await get(agent, db)];
    expect({ statuses: answers.map((answer) => answer.status), reads: db.calls }).toEqual({
      statuses: [403, 403],
      reads: [],
    });
  });

  it("opens for an admin who signed in two hours ago, as the Settings read does", async () => {
    const db = fakeDb({ tables: { vendor_usage: [] } });
    const answer = await get(
      { ...admin, session: { id: "s-1", signedInAt: Date.now() - 2 * 3_600_000 } },
      db,
    );
    expect(answer.status).toBe(200);
  });

  it("refuses the service itself to a roleless actor, before any read", async () => {
    const db = fakeDb({ tables: { vendor_usage: [] } });
    await expect(
      getUsage({ ...admin, roles: [], requestId: "req-usage" }, db),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it("answers the five lines in a fixed order, and a line never recorded has no figures", async () => {
    const db = fakeDb({
      tables: {
        vendor_usage: [
          row("claude_week", { used: 42, limit_value: 100, note: "Resets Sat, Oct 17" }),
          row("sentry_errors", { used: 12 }),
        ],
      },
    });
    const answer = await get(admin, db);
    const empty = { used: null, limit: null, percent: null, note: null, measured_at: null };
    expect(answer.body).toEqual({
      lines: [
        { line: "workers_requests_day", ...empty },
        { line: "storage_egress", ...empty },
        {
          line: "sentry_errors",
          used: 12,
          limit: null,
          percent: null,
          note: null,
          measured_at: AT,
        },
        { line: "actions_minutes", ...empty },
        {
          line: "claude_week",
          used: 42,
          limit: 100,
          percent: 42,
          note: "Resets Sat, Oct 17",
          measured_at: AT,
        },
      ],
    });
  });

  it("gives the share of the recorded limit, rounded, and past 100 when the limit is passed", async () => {
    const db = fakeDb({
      tables: {
        vendor_usage: [
          row("workers_requests_day", { used: 2, limit_value: 3 }),
          row("actions_minutes", { used: 2500, limit_value: 2000 }),
        ],
      },
    });
    const answer = await get(admin, db);
    const lines = field(answer.body, "lines");
    expect(Array.isArray(lines) ? lines.map((line) => field(line, "percent")) : lines).toEqual([
      67,
      null,
      null,
      125,
      null,
    ]);
  });

  it("only reads the table vendor_usage", async () => {
    const db = fakeDb({ tables: { vendor_usage: [] } });
    await get(admin, db);
    expect(db.calls).toEqual([{ kind: "from", name: "vendor_usage", args: [] }]);
  });
});
