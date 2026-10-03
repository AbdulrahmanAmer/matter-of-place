// One time model (T-08, GQ-03). `FIXED_NOW` and `at` are for pure unit tests only: a test that talks to the
// database, the API or a browser takes its base from `dbNow(db)` and dates every row with `atFrom`.
import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;

export const FIXED_NOW = new Date("2026-10-01T12:00:00Z");

/** `days` after `FIXED_NOW` (negative for before). Pure unit tests only. */
export function at(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * DAY_MS);
}

/** `days` after `base`, a time read once from the database with `dbNow(db)`. */
export function atFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/** A seeded generator: the same seed gives the same numbers in [0, 1) on every run. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

/** A version 5 UUID over `namespace:n`, so the same call gives the same id forever. */
export function deterministicUuid(namespace: string, n: number): string {
  const hex = createHash("sha1")
    .update(DNS_NAMESPACE)
    .update(`${namespace}:${String(n)}`)
    .digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
