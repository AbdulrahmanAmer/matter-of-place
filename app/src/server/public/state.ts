import { applyVisibility } from "../catalog/visibility.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import { readVar } from "../lib/runtime-env.ts";
import { z } from "zod";
import type { PropertyCard } from "../../domain/property.ts";
import { mapSnapshot, parseSnapshot, toPropertyCard, type Catalog } from "./mappers.ts";

// The one read path of the public site (architecture 13 rule 1, invariant 15): two RPCs, memoised per
// isolate, the last good answer kept for an outage. The job runner loads this file, so it reads
// variables with `readVar` and takes the client as an argument (G39).

const READ_TIMEOUT_MS = 2000;
const REPORT_EVERY_MS = 60_000;
const DEFAULT_TTL_MS = 15_000;
const SLOW_READ_MS = 1000;
// Gap audit item 9: the last good state and snapshot also go to the Worker's own cache store, so an isolate that has
// just started, with nothing in memory, answers from them instead of "unavailable". Keyed by environment, since every
// Worker of the account's workers.dev subdomain reads the same store (P-3190). The job runner has no `caches.default`
// and keeps nothing there.
const KEPT_BASE = "https://cache.mop.internal/last-good/state";
const KEPT_MAX_AGE = 604_800;

const looseObject = z.record(z.string(), z.unknown());

// The eight keys of G39 as H80 amended it, and no others. A missing `coming_soon_global`, `site`, `og_static` or
// `products` reads as empty (`products` as null: the caller falls back to the seed). `products` is the stored value as it is, whatever
// its shape: `productsOf` judges it, so a malformed row costs one line and the seed, never the whole state.
const publicStateSchema = z
  .object({
    catalog_version: z.number(),
    flags: looseObject,
    coming_soon_global: z.boolean().nullable(),
    coming_soon_markets: z.record(z.string(), z.boolean()),
    site: looseObject.nullable(),
    illustrative_content: z.boolean(),
    og_static: looseObject.nullish(),
    products: z.unknown().nullish(),
  })
  .transform((raw) => ({
    catalogVersion: raw.catalog_version,
    flags: raw.flags,
    comingSoonGlobal: raw.coming_soon_global ?? false,
    comingSoonMarkets: raw.coming_soon_markets,
    site: raw.site ?? {},
    illustrativeContent: raw.illustrative_content,
    ogStatic: raw.og_static ?? {},
    products: raw.products ?? null,
  }));

export type PublicState = z.output<typeof publicStateSchema>;

export interface StateRead {
  state: PublicState;
  /** True when the RPC failed and the last good state is what this is. */
  stale: boolean;
}

/** The visible catalog and its list rows side by side, both built once per version (PERF-06). */
export type ServedCatalog = Catalog & { cards: PropertyCard[] };

export interface CatalogRead extends StateRead {
  catalog: ServedCatalog;
}

let stateMemo: { state: PublicState; checkedAt: number; stale: boolean } | undefined;
let stateFlight: Promise<StateRead> | undefined;
let catalogMemo: ServedCatalog | undefined;
// The version the state advertised when the memo was loaded, which the memo answers for.
let catalogFor = Number.NaN;
// One load per version: a request for a newer version never waits for a load of an older one.
let catalogFlight: { version: number; load: Promise<ServedCatalog> } | undefined;
let catalogStale = false;
let lastReportAt = Number.NEGATIVE_INFINITY;
const pendingReports: unknown[] = [];

function ttlMs(): number {
  const raw = Number.parseInt(readVar("CATALOG_VERSION_TTL_MS") ?? "", 10);
  return Number.isNaN(raw) ? DEFAULT_TTL_MS : raw;
}

const unavailable = (): AppError =>
  new AppError("unavailable", undefined, "The catalog is not available right now.");

/** An answer that outlasts `ms` is a failure, whatever client was injected. */
function within<T>(pending: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no answer in ${String(ms)} ms`));
    }, ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("rpc failed"));
      },
    );
  });
}

type ReadName = "public_state" | "public_catalog_snapshot";

async function readRpc(db: Db, name: ReadName): Promise<unknown> {
  const started = Date.now();
  const { data, error } = await within(
    name === "public_state" ? db.rpc("public_state") : db.rpc("public_catalog_snapshot"),
    READ_TIMEOUT_MS,
  );
  // Gap audit item 9: a slow answer is a line in the Worker's logs, before it ever becomes a timeout.
  const ms = Date.now() - started;
  if (ms >= SLOW_READ_MS) logLine("warn", "public_read_slow", { rpc: name, ms });
  if (error !== null) throw new Error(`${name}: ${error.message}`);
  return data;
}

const keptCacheSchema = z.object({
  default: z.custom<Cache>(
    (value) => typeof value === "object" && value !== null && "match" in value && "put" in value,
  ),
});

function keptCache(): Cache | undefined {
  const parsed = keptCacheSchema.safeParse(Reflect.get(globalThis, "caches"));
  return parsed.success ? parsed.data.default : undefined;
}

const keptKey = (name: ReadName): string =>
  `${KEPT_BASE}/${readVar("MOP_ENV") ?? "production"}/${name}`;
// Per isolate: the catalog version each kept copy was last written at, so a copy is written once per version.
const keptAt = new Map<ReadName, number>();

/** Keeps a good answer for a cold isolate; a failure to keep it never fails the read. */
async function keep(name: ReadName, version: number, raw: unknown): Promise<void> {
  const cache = keptCache();
  if (cache === undefined || keptAt.get(name) === version) return;
  try {
    await cache.put(
      keptKey(name),
      new Response(JSON.stringify(raw), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${String(KEPT_MAX_AGE)}`,
        },
      }),
    );
    keptAt.set(name, version);
  } catch (error) {
    logLine("warn", "public_read_keep_failed", {
      rpc: name,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** The kept answer, or undefined when there is none or it cannot be read. */
async function kept(name: ReadName): Promise<unknown> {
  try {
    const found = await keptCache()?.match(keptKey(name));
    return found === undefined ? undefined : await found.json();
  } catch {
    return undefined;
  }
}

/** One log line and one Sentry report a minute per isolate, however often the read fails. */
function noteFailure(rpc: string, error: unknown): void {
  const now = Date.now();
  if (now - lastReportAt < REPORT_EVERY_MS) return;
  lastReportAt = now;
  logLine("warn", "public_read_stale", { rpc });
  pendingReports.push(error);
}

/** The failures `noteFailure` queued, for the caller to send after its response (`waitUntil`). */
export function drainStaleReports(): unknown[] {
  return pendingReports.splice(0);
}

async function refreshState(db: Db): Promise<StateRead> {
  const now = Date.now();
  try {
    const raw = await readRpc(db, "public_state");
    const state = publicStateSchema.parse(raw);
    stateMemo = { state, checkedAt: now, stale: false };
    await keep("public_state", state.catalogVersion, raw);
    return { state, stale: false };
  } catch (error) {
    noteFailure("public_state", error);
    if (stateMemo === undefined) {
      // A cold isolate: the copy kept by an earlier one, or nothing.
      const copy = publicStateSchema.safeParse(await kept("public_state"));
      if (!copy.success) throw unavailable();
      stateMemo = { state: copy.data, checkedAt: now, stale: true };
      return { state: copy.data, stale: true };
    }
    // Held for one more interval, so an outage costs one attempt per interval and not one per request.
    stateMemo = { ...stateMemo, checkedAt: now, stale: true };
    return { state: stateMemo.state, stale: true };
  }
}

/** The public state and whether it is the last good copy. One RPC per interval per isolate. */
export function readState(db: Db): Promise<StateRead> {
  if (stateMemo !== undefined && Date.now() - stateMemo.checkedAt < ttlMs()) {
    return Promise.resolve({ state: stateMemo.state, stale: stateMemo.stale });
  }
  stateFlight ??= refreshState(db).finally(() => {
    stateFlight = undefined;
  });
  return stateFlight;
}

/** Makes the next `getPublicState` call the RPC; the last good state stays for an outage (B8b's `putFlags`). */
export function resetPublicStateMemo(): void {
  if (stateMemo !== undefined) stateMemo = { ...stateMemo, checkedAt: Number.NEGATIVE_INFINITY };
}

function buildCatalog(raw: unknown, state: PublicState): ServedCatalog {
  const mapped = mapSnapshot(parseSnapshot(raw), state);
  const visible = applyVisibility(mapped, {
    state,
    env: { MOP_ENV: readVar("MOP_ENV") ?? "production" },
  });
  return { ...visible, cards: visible.properties.map(toPropertyCard) };
}

async function loadCatalog(db: Db, state: PublicState): Promise<ServedCatalog> {
  const raw = await readRpc(db, "public_catalog_snapshot");
  const catalog = buildCatalog(raw, state);
  // A load that started under an older state can finish after a newer one: the memo never goes back.
  if (!(state.catalogVersion < catalogFor)) {
    catalogMemo = catalog;
    catalogFor = state.catalogVersion;
  }
  await keep("public_catalog_snapshot", state.catalogVersion, raw);
  return catalog;
}

/** A cold isolate's catalog during an outage: built from the kept snapshot, never stored in the memo. */
async function keptCatalog(state: PublicState): Promise<ServedCatalog> {
  const raw = await kept("public_catalog_snapshot");
  if (raw === undefined) throw unavailable();
  try {
    return buildCatalog(raw, state);
  } catch {
    throw unavailable();
  }
}

/** The mapped catalog, fetched again only when the state names a newer version. */
export async function readCatalog(db: Db): Promise<CatalogRead> {
  const { state, stale } = await readState(db);
  if (catalogMemo !== undefined && catalogFor === state.catalogVersion) {
    catalogStale = false;
    return { catalog: catalogMemo, state, stale };
  }
  try {
    if (catalogFlight?.version !== state.catalogVersion) {
      const load: Promise<ServedCatalog> = loadCatalog(db, state).finally(() => {
        if (catalogFlight?.load === load) catalogFlight = undefined;
      });
      catalogFlight = { version: state.catalogVersion, load };
    }
    const catalog = await catalogFlight.load;
    catalogStale = false;
    return { catalog, state, stale };
  } catch (error) {
    noteFailure("public_catalog_snapshot", error);
    if (catalogMemo === undefined) {
      const catalog = await keptCatalog(state);
      catalogStale = true;
      return { catalog, state, stale: true };
    }
    catalogStale = true;
    return { catalog: catalogMemo, state, stale: true };
  }
}

/**
 * True while this isolate answers from a copy older than the database (the state or the catalog could not
 * be read). Nothing built meanwhile is stored: a stale body must never sit under a newer version's key.
 */
export function servingStale(): boolean {
  return (stateMemo?.stale ?? false) || catalogStale;
}

export async function getPublicState(db: Db): Promise<PublicState> {
  return (await readState(db)).state;
}

export async function getCatalog(db: Db): Promise<ServedCatalog> {
  return (await readCatalog(db)).catalog;
}
