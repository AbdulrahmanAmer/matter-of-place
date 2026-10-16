// Page names in words for the Interest screen (market names: src/lib/market-names.ts).

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
