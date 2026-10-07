import type { FakeDb } from "./fake-db";

export type Row = Record<string, unknown>;

// `fakeDb` answers a registered table with every row whatever the query asks. A service that reads through filters
// (an entity's rows, a request's photographs) is tested against this instead: the rows go through the same `eq`, `in`,
// PostgREST `or` text, `order`, `limit`, `range` and column list the query names, so a wrong filter returns the wrong
// rows.

const resolved = (data: unknown) => Promise.resolve({ data, error: null });

/** A column, `payload->data->>key` (in `eq`, `in` and the `or` text of `entityJobsFilter`). */
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

interface Shape {
  columns: readonly string[];
  orders: readonly Order[];
  /** `select(columns, { count: "exact" })`: the answer carries the count of the filtered rows, before `range`. */
  counted: boolean;
}

function query(all: readonly Row[], shape: Shape) {
  const rows = sorted(all, shape.orders);
  const shown = (part: readonly Row[]) =>
    part.map((row) =>
      shape.columns.includes("*")
        ? row
        : Object.fromEntries(shape.columns.map((name) => [name, row[name]])),
    );
  const answer = (part: readonly Row[]) =>
    Promise.resolve({ data: shown(part), error: null, count: shape.counted ? rows.length : null });
  const next = (part: readonly Row[], orders = shape.orders) => query(part, { ...shape, orders });
  return Object.assign(answer(rows), {
    eq: (column: string, value: unknown) =>
      next(rows.filter((row) => valueAt(row, column) === value)),
    in: (column: string, values: readonly unknown[]) =>
      next(rows.filter((row) => values.includes(valueAt(row, column)))),
    or: (text: string) =>
      next(rows.filter((row) => text.split(",").some((term) => matchesTerm(row, term)))),
    order: (column: string, options?: { ascending?: boolean }) =>
      next(rows, [...shape.orders, [column, options?.ascending === false ? -1 : 1]]),
    limit: (count: number) => next(rows.slice(0, count)),
    range: (from: number, to: number) => answer(rows.slice(from, to + 1)),
    maybeSingle: () => resolved(shown(rows)[0] ?? null),
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
        select: (columns = "*", options?: { count?: string }) =>
          query(rows, {
            columns: columns.split(",").map((column) => column.trim()),
            orders: [],
            counted: options?.count !== undefined,
          }),
      };
    },
  });
}
