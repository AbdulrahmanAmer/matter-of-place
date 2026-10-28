// W7 item 8 (the item's own text): "Interest by market for the Campaigns and Newsletter colleagues: confirmed signups
// per market and per page, this week and in total (the same read as the Interest screen, counts only, no addresses)."
// The counts come from `newsletter_interest_counts`, which reads the Interest screen's list (what
// `newsletter_export_subscribers` returns: every subscriber not archived and not anonymised), keeps the confirmed and
// not unsubscribed, and groups them in the database: no subscriber row leaves it, so no read meets PostgREST's row cap
// (max_rows), and the export is not called because it is an admin's audited read, gated by the role matrix.
// The cache rule (architecture 13) is for public reads; this is an internal read of the runner, one call a run.
import type { Db } from "../../src/server/lib/db.ts";
import { marketSlugSchema, regionSlugSchema } from "../../src/domain/market.ts";
import { sourceName } from "../../src/admin/newsletter/interest-names.ts";
import { marketName } from "../../src/lib/market-names.ts";

/** The colleagues shown the block: they plan the campaigns and the newsletter the interest is for. */
const READERS: readonly string[] = ["campaigns", "newsletter"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MARKETS = marketSlugSchema.options;
const REGIONS = regionSlugSchema.options;

/** A region in words: each region's name is its slug's words, capitalised ("the-hamptons" → "The Hamptons"). */
const regionName = (slug: string) =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

// A page as our forms name it (`interestSource`, the stories and Place Notes forms), with its name. The database
// counts any other text in the column, sent by a visitor, under "Other pages" and never returns it.
const PAGES = new Map<string, string>([
  ...["place-notes", "stories", "interest:home", "interest:properties", "interest:stories"].map(
    (source): [string, string] => [source, sourceName(source)],
  ),
  ...MARKETS.map((market): [string, string] => [
    `interest:${market}`,
    `${marketName(market)} page`,
  ]),
  ...MARKETS.flatMap((market) =>
    REGIONS.map((region): [string, string] => [
      `interest:${market}/${region}`,
      `${marketName(market)}, ${regionName(region)} page`,
    ]),
  ),
]);

/** A row of `newsletter_interest_counts`: a market's count (source empty) or a page's (market empty). */
export interface InterestRow {
  market: string;
  source: string;
  this_week: number;
  total: number;
}

interface Count {
  week: number;
  total: number;
}

const counted = (count: Count) =>
  `${String(count.week)} this week, ${String(count.total)} in total`;

const add = (count: Count, row: InterestRow) => {
  count.week += row.this_week;
  count.total += row.total;
};

/**
 * The block: confirmed signups per market (California, New York, Florida) and per page, this week and in total. A
 * signup that names a market twice counts once for it (the database counts its distinct markets); one that names two
 * markets counts once in each, so the market lines can add up to more than all signups.
 */
export function interestBlock(rows: readonly InterestRow[]): string {
  const all: Count = { week: 0, total: 0 };
  const markets = new Map<string, Count>(MARKETS.map((slug) => [slug, { week: 0, total: 0 }]));
  const pages = new Map<string, Count>();
  for (const row of rows) {
    if (row.market !== "") {
      const market = markets.get(row.market);
      if (market !== undefined) add(market, row);
      continue;
    }
    const page = PAGES.get(row.source) ?? "Other pages";
    const onPage = pages.get(page) ?? { week: 0, total: 0 };
    pages.set(page, onPage);
    add(onPage, row);
    add(all, row);
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
    const { data, error } = await client.rpc("newsletter_interest_counts", {
      p_since: new Date(now.getTime() - WEEK_MS).toISOString(),
      p_pages: [...PAGES.keys()],
    });
    if (error !== null) throw new Error("not read");
    return [interestBlock(data)];
  } catch {
    return ["The interest counts could not be read for this run; say so if a plan needs them."];
  }
}
