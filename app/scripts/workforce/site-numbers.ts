// W7 item 10 (the item's own text): "Site numbers for the Analyst: `analytics_daily` for the last 7 and 28 days (visits,
// top pages, signups, inquiries by market), so its weekly report reads real numbers instead of searching for them."
// The numbers come from `analyst_site_numbers`, which sums `analytics_daily` and counts `inquiries` in the database: no
// daily row leaves it, so no read meets PostgREST's row cap (max_rows), and a top page is named only when it is one of
// ours (a beacon's path is a visitor's text). The daily totals are rolled up after each UTC day ends (the retention
// job), so both windows end yesterday. Inquiries by market come from `inquiries`, the table the scorecard counts, since
// the daily totals carry a page, not a market. One call a run of the Analyst; the cache rule (architecture 13) is for
// public reads.
import type { Db } from "../../src/server/lib/db.ts";
import { marketSlugSchema } from "../../src/domain/market.ts";
import { marketName } from "../../src/lib/market-names.ts";
import { staticSitemapPaths } from "../../src/server/seo/sitemap.ts";

/** The colleague shown the block: it writes the weekly report. */
const READERS: readonly string[] = ["analyst"];
const WINDOWS = [7, 28] as const;
const MARKETS = marketSlugSchema.options;

/**
 * Our fixed pages and every market's page and guide: the database adds each region's page (from its market and region
 * rows, the one market-to-region list), archive pages, and published properties and stories.
 */
const PAGES: readonly string[] = [
  ...staticSitemapPaths,
  ...MARKETS.flatMap((market) => [`/${market}`, `/${market}/guide`]),
];

/** A page's address as our routes and slugs make them; the database already names our pages only, this holds twice. */
const PATH_SHAPE = /^\/[a-z0-9-]*(\/[a-z0-9-]+)*$/;

const SIGNUPS = new Map<string, string>([
  ["newsletter_signup", "Place Notes form"],
  ["interest_signup", "interest form"],
  ["newsletter_confirmed", "confirmed"],
]);

/** A row of `analyst_site_numbers`: one number of one window. */
export interface SiteRow {
  days: number;
  kind: string;
  label: string;
  events: number;
}

const n = (value: number) => value.toLocaleString("en-US");

function windowLines(rows: readonly SiteRow[], days: number): string[] {
  const mine = rows.filter((row) => row.days === days);
  const of = (kind: string) => mine.filter((row) => row.kind === kind);
  const visits = of("visits").reduce((sum, row) => sum + row.events, 0);
  const pages = of("page")
    .filter((row) => PATH_SHAPE.test(row.label))
    .sort((a, b) => b.events - a.events || a.label.localeCompare(b.label))
    .map((row) => `${row.label} (${n(row.events)})`);
  const signups = [...SIGNUPS].map(
    ([event, name]) => `${name} ${n(of("signup").find((row) => row.label === event)?.events ?? 0)}`,
  );
  const inquiries = of("inquiries");
  const inMarket = (slug: string) => inquiries.find((row) => row.label === slug)?.events ?? 0;
  const elsewhere = inquiries
    .filter((row) => !MARKETS.some((slug) => slug === row.label))
    .reduce((sum, row) => sum + row.events, 0);
  return [
    `Last ${String(days)} days:`,
    `- Page views: ${n(visits)}`,
    `- Top pages: ${pages.length === 0 ? "none yet" : pages.join(", ")}`,
    `- Signups: ${signups.join(", ")}`,
    `- Inquiries by market: ${[
      ...MARKETS.map((slug) => `${marketName(slug)} ${n(inMarket(slug))}`),
      `no market named ${n(elsewhere)}`,
    ].join(", ")}`,
  ];
}

/** The block: visits, the ten top pages, signups and inquiries by market, for the last 7 and 28 days. */
export function siteNumbersBlock(rows: readonly SiteRow[]): string {
  return [
    "Site numbers (UTC days ending yesterday, from the daily totals; inquiries from the inquiries received):",
    ...WINDOWS.flatMap((days) => windowLines(rows, days)),
    "Page views count only the pages that send a view event: property, market, market guide, region, story and archive pages, and home, /properties and /stories while they show coming soon; a coming-soon page counts once. Every other page (/about, /contact, /guides and the rest) sends none, so its visits are not here. A top page is named only when it is one of our pages.",
  ].join("\n");
}

/** The block for an Analyst run; nothing for anyone else. A failed read is one plain line. */
export async function siteNumbersLines(
  client: Db,
  agentSlug: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (!READERS.includes(agentSlug)) return [];
  try {
    const { data, error } = await client.rpc("analyst_site_numbers", {
      p_to: now.toISOString().slice(0, 10),
      p_pages: [...PAGES],
    });
    if (error !== null) throw new Error("not read");
    return [siteNumbersBlock(data)];
  } catch {
    return ["The site numbers could not be read for this run; say so if the report needs them."];
  }
}
