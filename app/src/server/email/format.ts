// Money and dates as they read in an email. Runs in Deno as well as in Workers, so it imports nothing from
// `src/config` or `src/lib`, which read `import.meta.env`.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const longDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** `payments.amount` (`numeric(12,2)`, a string from PostgREST) in dollars: `"1500.00"` is `$1,500.00`. */
export function formatUsd(amount: string | number): string {
  return usd.format(Number(amount));
}

/** An ISO timestamp as a long UTC date: `2026-11-15T10:00:00Z` is `November 15, 2026`. */
export function formatDate(iso: string): string {
  return longDate.format(new Date(iso));
}
