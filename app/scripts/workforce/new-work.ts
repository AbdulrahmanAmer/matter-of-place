// W7 item 9 (the item's own text): "the content of new work, not only its count: the newest submissions and inquiries in
// short form (market, type, price band, state) for the Editor and the Concierge, so a briefing can name the request it
// is about". The block is built from structured columns only (enums, numbers, dates, ids), never a word the person
// typed, read once a pass and shown to the owners of those two sources in every run that carries no outside message.
import type { Db } from "../../src/server/lib/db.ts";
import type { SourceName } from "./criteria.ts";
import { field, priceReading } from "./request-desk.ts";

const NEWEST = 5;
// A property page's slug as our pages make it; anything else in the column is not shown.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NewRequest {
  id: string;
  received_at: string;
  state: string;
  property_type: string;
  price: number | null;
  workflow_state: string;
}

export interface NewInquiry {
  id: string;
  received_at: string;
  intent: string;
  state: string;
  subject_kind: string | null;
  subject_slug: string | null;
}

/** A price as a band: the briefing names the range, never the figure. */
export function priceBand(price: number | null): string {
  const reading = priceReading(price);
  if (reading === "none" || price === null) return "no price given";
  if (reading === "rent") return "a monthly rent";
  if (price < 2_000_000) return "under $2M";
  if (price < 5_000_000) return "$2M to $5M";
  if (price < 10_000_000) return "$5M to $10M";
  if (price < 25_000_000) return "$10M to $25M";
  return "$25M and above";
}

/** The briefing block: the newest requests and inquiries, one short line each, newest first. */
export function newWorkBlock(
  requests: readonly NewRequest[],
  inquiries: readonly NewInquiry[],
  markets: ReadonlyMap<string, string>,
): string {
  const about = (inquiry: NewInquiry) => {
    const slug = inquiry.subject_slug ?? "";
    if (inquiry.subject_kind !== "property" || !SLUG.test(slug) || slug.length > 80)
      return "no property named";
    const market = markets.get(slug);
    return `the property ${slug}${market === undefined ? "" : ` (${field(market)} market)`}`;
  };
  return [
    "New work, newest first (from our records' structured fields; name a request by its id to brief on it):",
    "Requests:",
    ...(requests.length === 0
      ? ["- none yet"]
      : requests.map(
          (row) =>
            `- request ${field(row.id)}: ${field(row.state)}, ${field(row.property_type)}, ${priceBand(row.price)}, ${field(row.workflow_state)}, received ${field(row.received_at.slice(0, 10))}`,
        )),
    "Inquiries:",
    ...(inquiries.length === 0
      ? ["- none yet"]
      : inquiries.map(
          (row) =>
            `- inquiry ${field(row.id)}: ${field(row.intent)}, ${field(row.state)}, about ${about(row)}, received ${field(row.received_at.slice(0, 10))}`,
        )),
  ].join("\n");
}

async function readNewWork(client: Db): Promise<string> {
  try {
    const [requests, inquiries] = await Promise.all([
      client
        .from("submissions")
        .select("id, received_at, state, property_type, price, workflow_state")
        .order("received_at", { ascending: false })
        .limit(NEWEST),
      client
        .from("inquiries")
        .select("id, received_at, intent, state, subject_kind, subject_slug")
        .order("received_at", { ascending: false })
        .limit(NEWEST),
    ]);
    if (requests.error !== null || inquiries.error !== null) throw new Error("not read");
    const slugs = inquiries.data.flatMap((row) =>
      row.subject_slug !== null && SLUG.test(row.subject_slug) ? [row.subject_slug] : [],
    );
    const properties =
      slugs.length === 0
        ? []
        : ((await client.from("properties").select("slug, market_slug").in("slug", slugs)).data ??
          []);
    return newWorkBlock(
      requests.data.slice(0, NEWEST),
      inquiries.data.slice(0, NEWEST),
      new Map(properties.map((row) => [row.slug, row.market_slug])),
    );
  } catch {
    return "The newest requests and inquiries could not be read this pass; say so if a briefing needs them.";
  }
}

let thisPass: Promise<string> | null = null;

/** A new pass reads the newest work afresh (`daemon.ts` calls this as each pass starts). */
export function forgetNewWork(): void {
  thisPass = null;
}

/**
 * The block for a run whose colleague owns requests or inquiries (the Editor and the Concierge, `ownsSource`), read
 * once a pass and shared by its runs; nothing for anyone else.
 */
export async function newWorkLines(
  client: Db,
  owns: (source: SourceName) => boolean,
): Promise<string[]> {
  if (!owns("submission") && !owns("inquiry")) return [];
  thisPass ??= readNewWork(client);
  return [await thisPass];
}
