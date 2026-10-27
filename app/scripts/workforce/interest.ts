// W7 item 8 (the item's own text): "Interest by market for the Campaigns and Newsletter colleagues: confirmed signups
// per market and per page, this week and in total (the same read as the Interest screen, counts only, no addresses)."
// The rows are the Interest screen's: `newsletter_export_subscribers` (what `listInterest` reads) returns every
// subscriber that is not archived and not anonymised, confirmed when `confirmed_at` is set and `unsubscribed_at` is
// not. The runner reads those same rows of `subscribers` through the service role, never the email column, and counts
// here; that function is not called because it is an admin's audited export, gated by the role matrix.
// The cache rule (architecture 13) is for public reads; this is an internal read of the runner, one query a run.
import type { Db } from "../../src/server/lib/db.ts";
import { marketSlugSchema, regionSlugSchema } from "../../src/domain/market.ts";
import { sourceName } from "../../src/admin/newsletter/interest-names.ts";
import { marketName } from "../../src/lib/market-names.ts";

/** The colleagues shown the block: they plan the campaigns and the newsletter the interest is for. */
const READERS: readonly string[] = ["campaigns", "newsletter"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MARKETS = marketSlugSchema.options;
const REGIONS = regionSlugSchema.options;
// A page as our forms name it (`interestSource`, the stories and Place Notes forms); any other text in the column was
// sent by a visitor and is counted under "Other pages", never repeated.
const OUR_PAGE = new RegExp(
  `^(?:place-notes|stories|interest:(?:home|properties|stories)|interest:(?:${MARKETS.join("|")})(?:/(?:${REGIONS.join("|")}))?)$`,
);

export interface InterestRow {
  markets: readonly string[];
  source: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

interface Count {
  week: number;
  total: number;
}

const counted = (count: Count) =>
  `${String(count.week)} this week, ${String(count.total)} in total`;

/** The block: confirmed signups per market (California, New York, Florida) and per page, this week and in total. */
export function interestBlock(rows: readonly InterestRow[], now: Date): string {
  const since = now.getTime() - WEEK_MS;
  const all: Count = { week: 0, total: 0 };
  const markets = new Map<string, Count>(MARKETS.map((slug) => [slug, { week: 0, total: 0 }]));
  const pages = new Map<string, Count>();
  for (const row of rows) {
    if (row.confirmed_at === null || row.unsubscribed_at !== null) continue;
    const thisWeek = Date.parse(row.confirmed_at) >= since ? 1 : 0;
    const page = OUR_PAGE.test(row.source) ? sourceName(row.source) : "Other pages";
    const onPage = pages.get(page) ?? { week: 0, total: 0 };
    pages.set(page, onPage);
    const counts: Count[] = [all, onPage];
    for (const slug of new Set(row.markets)) {
      const market = markets.get(slug);
      if (market !== undefined) counts.push(market);
    }
    for (const count of counts) {
      count.week += thisWeek;
      count.total += 1;
    }
  }
  return [
    "Interest by market and page (confirmed signups from the list the Interest screen reads; this week is the seven days to this read):",
    "By market:",
    ...[...markets].map(([slug, count]) => `- ${marketName(slug)}: ${counted(count)}`),
    "By page:",
    ...(pages.size === 0
      ? ["- none yet"]
      : [...pages]
          .sort(([a, x], [b, y]) => y.total - x.total || a.localeCompare(b))
          .map(([page, count]) => `- ${page}: ${counted(count)}`)),
    `All confirmed signups: ${counted(all)}.`,
  ].join("\n");
}

/** The block for a Campaigns or Newsletter run; nothing for anyone else. A failed read is one plain line. */
export async function interestLines(
  client: Db,
  agentSlug: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (!READERS.includes(agentSlug)) return [];
  try {
    const { data, error } = await client
      .from("subscribers")
      .select("markets, source, confirmed_at, unsubscribed_at")
      .is("archived_at", null)
      .not("email", "like", "%.invalid");
    if (error !== null) throw new Error("not read");
    return [interestBlock(data, now)];
  } catch {
    return ["The interest counts could not be read for this run; say so if a plan needs them."];
  }
}
