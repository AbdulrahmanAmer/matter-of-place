// B7 step 15: screen 25's reader. `listAuditLog` authorizes `audit.list` (chief editor and admin), parses the filters
// with `auditListInputSchema` and pages `audit_log` by keyset on (at desc, id desc), every filter an AND.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { listAuditLog } from "../../src/server/audit/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";

type Row = Record<string, string | number | null>;

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-0000000000c0",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-audit",
});

const auditRow = (id: number, at: string, over: Row = {}): Row => ({
  id,
  at,
  actor_id: null,
  actor_kind: null,
  action: "settings.notifications_put",
  entity: "settings.notifications",
  entity_id: null,
  before: null,
  after: null,
  request_id: "req-a",
  note: null,
  ...over,
});

// Three rows share one instant, so a page that ends inside them must go on with the lower ids of that instant.
const ROWS: Row[] = [
  auditRow(1, "2026-10-09T10:00:00.000001+00:00"),
  auditRow(2, "2026-10-09T11:00:00.000002+00:00", { request_id: "req-b" }),
  auditRow(3, "2026-10-09T11:00:00.000002+00:00"),
  auditRow(4, "2026-10-09T11:00:00.000002+00:00", { request_id: "req-b" }),
  auditRow(5, "2026-10-09T12:00:00.000003+00:00"),
];

/** `audit_log` through the filters, order and limit `listAudit` uses; the ISO strings of one zone sort as times. */
function auditDb(rows: readonly Row[]): FakeDb {
  const db = fakeDb();
  const query = (part: readonly Row[], orders: [string, number][] = []) => {
    const keep = (test: (row: Row) => boolean) => query(part.filter(test), orders);
    return Object.assign(Promise.resolve({ data: part, error: null }), {
      eq: (column: string, value: unknown) => keep((row) => row[column] === value),
      lt: (column: string, value: string | number) => keep((row) => (row[column] ?? "") < value),
      gte: (column: string, value: string) => keep((row) => String(row[column]) >= value),
      order: (column: string, options: { ascending: boolean }) => {
        const next: [string, number][] = [...orders, [column, options.ascending ? 1 : -1]];
        const sorted = [...part].sort((a, b) => {
          for (const [name, sign] of next) {
            const [left, right] = [a[name] ?? "", b[name] ?? ""];
            if (left !== right) return left < right ? -sign : sign;
          }
          return 0;
        });
        return query(sorted, next);
      },
      limit: (count: number) => query(part.slice(0, count), orders),
    });
  };
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      if (name !== "audit_log") throw new Error(`unexpected table ${name}`);
      return { select: () => query(rows) };
    },
  });
}

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const refusal = (error: unknown) =>
  error instanceof AppError ? `${String(error.status)} ${error.code}` : String(error);

const ids = (page: { items: { id: number }[] }) => page.items.map((item) => item.id);

describe("listAuditLog", () => {
  it("refuses a managing editor with 403 before it reads", async () => {
    const db = auditDb(ROWS);
    const error = await failureOf(listAuditLog(actor(["managing_editor"]), db, {}));
    expect({ error: refusal(error), reads: db.calls.length }).toEqual({
      error: "403 forbidden",
      reads: 0,
    });
  });

  it("refuses limit=51 with 422 validation before it reads", async () => {
    const db = auditDb(ROWS);
    const error = await failureOf(listAuditLog(actor(["admin"]), db, { limit: "51" }));
    expect({ error: refusal(error), reads: db.calls.length }).toEqual({
      error: "422 validation",
      reads: 0,
    });
  });

  it("with a request_id returns only that request's rows, newest first", async () => {
    const page = await listAuditLog(actor(["chief_editor"]), auditDb(ROWS), {
      request_id: "req-b",
    });
    expect({ ids: ids(page), next: page.next_cursor }).toEqual({ ids: [4, 2], next: null });
  });

  it("pages by (at desc, id desc): a page that ends inside one instant goes on with that instant's lower ids", async () => {
    const db = auditDb(ROWS);
    const first = await listAuditLog(actor(["admin"]), db, { limit: "2" });
    const second = await listAuditLog(actor(["admin"]), db, {
      limit: "2",
      cursor: first.next_cursor ?? "",
    });
    const third = await listAuditLog(actor(["admin"]), db, {
      limit: "2",
      cursor: second.next_cursor ?? "",
    });
    expect([first, second, third].map((page) => [ids(page), page.next_cursor])).toEqual([
      [[5, 4], "2026-10-09T11:00:00.000002+00:00~4"],
      [[3, 2], "2026-10-09T11:00:00.000002+00:00~2"],
      [[1], null],
    ]);
  });

  it("keeps rows at or after from and before to", async () => {
    const page = await listAuditLog(actor(["admin"]), auditDb(ROWS), {
      from: "2026-10-09T11:00:00.000002+00:00",
      to: "2026-10-09T12:00:00.000003+00:00",
    });
    expect(ids(page)).toEqual([4, 3, 2]);
  });

  it("refuses a cursor it did not write with 422 validation", async () => {
    const error = await failureOf(
      listAuditLog(actor(["admin"]), auditDb(ROWS), { cursor: "not-a-cursor" }),
    );
    expect(refusal(error)).toBe("422 validation");
  });
});
