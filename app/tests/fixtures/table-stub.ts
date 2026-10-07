import type { FakeDb } from "./fake-db";

export type Row = Record<string, unknown>;

// `fakeDb` answers a registered table with every row whatever the query asks. A service that reads through filters
// (an entity's rows, a request's photographs) is tested against this instead: the rows go through the same `eq`, `in`,
// PostgREST `or` text, `order`, `limit` and column list the query names, so a wrong filter returns the wrong rows.

const resolved = (data: unknown) => Promise.resolve({ data, error: null });

/** `payload->data->>key`, a column, or a dotted path of the `or` text of `entityJobsFilter`. */
function valueAt(row: Row, path: string): unknown {
  const [column = "", ...keys] = path.split(/->>?/);
  return keys.reduce<unknown>(
    (value, key) =>
      typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined,
    row[column],
  );
}

/** One term of a PostgREST `or` text: `<path>.eq.<value>` or `<path>.like.<pattern with *>`. */
function matchesTerm(row: Row, term: string): boolean {
  const [, path = "", operator = "", pattern = ""] = /^(.+?)\.(eq|like)\.(.*)$/.exec(term) ?? [];
  const value = valueAt(row, path);
  if (typeof value !== "string") return false;
  if (operator === "eq") return value === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

type Order = readonly [column: string, sign: 1 | -1];

/** The rows sorted by each `order()` call in turn, the first call the primary key, as PostgREST does. */
function sorted(rows: readonly Row[], orders: readonly Order[]): Row[] {
  const compare = (a: Row, b: Row) => {
    for (const [column, sign] of orders) {
      const [left, right] = [String(a[column]), String(b[column])];
      if (left !== right) return left < right ? -sign : sign;
    }
    return 0;
  };
  return [...rows].sort(compare);
}

function query(all: readonly Row[], columns: readonly string[], orders: readonly Order[] = []) {
  const rows = sorted(all, orders);
  const shown = rows.map((row) =>
    columns.includes("*") ? row : Object.fromEntries(columns.map((name) => [name, row[name]])),
  );
  return Object.assign(resolved(shown), {
    eq: (column: string, value: unknown) =>
      query(
        rows.filter((row) => row[column] === value),
        columns,
        orders,
      ),
    in: (column: string, values: readonly unknown[]) =>
      query(
        rows.filter((row) => values.includes(row[column])),
        columns,
        orders,
      ),
    or: (text: string) =>
      query(
        rows.filter((row) => text.split(",").some((term) => matchesTerm(row, term))),
        columns,
        orders,
      ),
    order: (column: string, options?: { ascending?: boolean }) =>
      query(rows, columns, [...orders, [column, options?.ascending === false ? -1 : 1]]),
    limit: (count: number) => query(rows.slice(0, count), columns, orders),
    maybeSingle: () => resolved(shown[0] ?? null),
  });
}

/** `db` with a `from()` that filters the rows of each registered table; an unregistered table throws. */
export function withTables(db: FakeDb, tables: Record<string, readonly Row[]>): FakeDb {
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      const rows = tables[name];
      if (rows === undefined) throw new Error(`unexpected table ${name}`);
      return {
        select: (columns = "*") =>
          query(
            rows,
            columns.split(",").map((column) => column.trim()),
          ),
      };
    },
  });
}
