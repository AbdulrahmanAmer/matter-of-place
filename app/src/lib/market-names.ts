// A market slug in words, for admin screens that name a market (Interest, Campaigns).

const MARKET_NAMES: Readonly<Record<string, string>> = {
  california: "California",
  "new-york": "New York",
  florida: "Florida",
  "place-notes": "Place Notes only",
};

/** "california" → "California"; an unknown slug in words. */
export function marketName(slug: string): string {
  return (
    MARKET_NAMES[slug] ?? slug.replace(/[-_]/g, " ").replace(/^\w/, (first) => first.toUpperCase())
  );
}
