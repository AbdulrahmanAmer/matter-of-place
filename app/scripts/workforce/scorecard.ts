// W2 step 7 (contract 9 and 14): the scorecard the Analyst opens every meeting with. Eight numbers for the last seven
// days against the seven before, read from the database by code, never written by a model, plus the free-tier gauges
// so Matter can say which upgrade comes next. A number the database cannot give says "not measured".
import type { Db } from "../../src/server/lib/db.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Line {
  name: string;
  now: number | null;
  before: number | null;
  unit?: "usd" | "percent";
}

function show(value: number | null, unit: Line["unit"]): string {
  if (value === null) return "not measured";
  if (unit === "usd") return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (unit === "percent") return `${String(Math.round(value))}%`;
  return value.toLocaleString("en-US");
}

/** "Visits: 151 (last week 0, up 151)"; one line per number. */
export function scorecardText(lines: readonly Line[]): string {
  return lines
    .map((line) => {
      const head = `${line.name}: ${show(line.now, line.unit)}`;
      if (line.now === null || line.before === null) return head;
      const change = line.now - line.before;
      const word =
        change === 0
          ? "no change"
          : change > 0
            ? `up ${show(change, line.unit)}`
            : `down ${show(-change, line.unit)}`;
      return `${head} (last week ${show(line.before, line.unit)}, ${word})`;
    })
    .join("\n");
}

/** The approved-as-is share in percent, or null when nothing was decided. */
export function asIsPercent(
  rows: readonly { state: string; edited_content: unknown }[],
): number | null {
  const decided = rows.filter((row) => row.state === "approved" || row.state === "rejected");
  if (decided.length === 0) return null;
  return (
    (100 *
      decided.filter((row) => row.state === "approved" && row.edited_content === null).length) /
    decided.length
  );
}

async function count(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count: value, error } = await query;
  return error === null ? (value ?? 0) : null;
}

async function windowLines(db: Db, from: Date, to: Date): Promise<Line[]> {
  const a = from.toISOString();
  const b = to.toISOString();
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const [visits, requests, inquiries, published, subscribers, posts, payments, approvals] =
    await Promise.all([
      db.from("analytics_daily").select("event, events").gte("day", day(from)).lt("day", day(to)),
      count(
        db
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .gte("received_at", a)
          .lt("received_at", b),
      ),
      count(
        db
          .from("inquiries")
          .select("id", { count: "exact", head: true })
          .gte("received_at", a)
          .lt("received_at", b),
      ),
      count(
        db
          .from("properties")
          .select("id", { count: "exact", head: true })
          .gte("first_published_at", a)
          .lt("first_published_at", b),
      ),
      count(
        db
          .from("subscribers")
          .select("id", { count: "exact", head: true })
          .gte("confirmed_at", a)
          .lt("confirmed_at", b),
      ),
      count(
        db
          .from("social_posts")
          .select("id", { count: "exact", head: true })
          .gte("posted_at", a)
          .lt("posted_at", b),
      ),
      db.from("payments").select("amount").gte("paid_at", a).lt("paid_at", b),
      db
        .from("agent_approvals")
        .select("state, edited_content")
        .gte("decided_at", a)
        .lt("decided_at", b),
    ]);
  const views =
    visits.error === null
      ? visits.data
          .filter((row) => row.event.endsWith("_view"))
          .reduce((sum, row) => sum + row.events, 0)
      : null;
  const revenue =
    payments.error === null ? payments.data.reduce((sum, row) => sum + row.amount, 0) : null;
  return [
    { name: "Visits (page views)", now: views, before: null },
    { name: "Property requests received", now: requests, before: null },
    { name: "Inquiries from buyers and agents", now: inquiries, before: null },
    { name: "Properties published", now: published, before: null },
    { name: "New Place Notes readers", now: subscribers, before: null },
    { name: "Social posts published", now: posts, before: null },
    { name: "Revenue paid", now: revenue, before: null, unit: "usd" },
    {
      name: "Team drafts approved as is",
      now: approvals.error === null ? asIsPercent(approvals.data) : null,
      before: null,
      unit: "percent",
    },
  ];
}

/** This week against last week, and the gauges at 70 percent or more of their limit. */
export async function scorecard(
  db: Db,
  now = new Date(),
): Promise<{ lines: Line[]; gauges: string[] }> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const [current, previous, gauges] = await Promise.all([
    windowLines(db, weekAgo, now),
    windowLines(db, twoWeeksAgo, weekAgo),
    db.from("vendor_usage").select("line, used, limit_value"),
  ]);
  const lines = current.map((line, index) => ({ ...line, before: previous[index]?.now ?? null }));
  const near =
    gauges.error === null
      ? gauges.data
          .filter(
            (row) =>
              row.limit_value !== null && row.limit_value > 0 && row.used / row.limit_value >= 0.7,
          )
          .map(
            (row) =>
              `${row.line} at ${String(Math.round((100 * row.used) / (row.limit_value ?? 1)))}% of its free limit`,
          )
      : [];
  return { lines, gauges: near };
}
