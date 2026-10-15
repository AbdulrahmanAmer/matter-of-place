// Market and page names in words for the Interest screen.

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

/** "interest:properties" → "Properties page"; "interest:market:california" → "Market page: california". */
export function sourceName(source: string): string {
  const parts = source.replace(/^interest:/, "").split(":");
  const [page = "", detail] = parts;
  const words = page.replace(/[-_]/g, " ").replace(/^\w/, (first) => first.toUpperCase());
  if (page === "") return "Unknown page";
  if (source.startsWith("interest:"))
    return detail === undefined ? `${words} page` : `${words} page: ${detail}`;
  return detail === undefined ? words : `${words}: ${detail}`;
}
