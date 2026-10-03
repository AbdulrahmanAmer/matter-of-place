// `bun run seed -- [--target dev|local] [--mode full|reference] [--images upload|skip]` (B2 Files, ruling H35).
// `full` is the illustrative catalog and refuses once the database is production; `reference` is the idempotent seed
// that launch runs, markets, regions, notes and guide entries only. Writes go through supabase-js with the service key.
import { guardEnv } from "./lib/guard-env.mjs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { holdDevLock } from "../tests/fixtures/dev-lock";
import { markets } from "../src/data/markets.ts";
import { properties } from "../src/data/properties.ts";
import { stories } from "../src/data/stories.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { stripExif } from "./lib/strip-exif.ts";
import {
  marketToRows,
  propertyToRows,
  publicationTime,
  storyToRow,
  type KeyOf,
} from "./lib/rows.ts";
import { localApiUrl, parseSeedArgs, type SeedArgs } from "./lib/seed-args.ts";
import { sha8Of, variantKeys } from "./variants.ts";

type Written = Readonly<Record<string, unknown>>;
interface UpsertOptions {
  onConflict: string;
  ignoreDuplicates?: true;
}

/** The two writes the seed needs, so a unit test can record them without a database. */
export interface SeedDb {
  upsert(table: string, rows: readonly Written[], options: UpsertOptions): Promise<void>;
  update(table: string, values: Written, where: Readonly<Record<string, string>>): Promise<void>;
}

export interface SeedDeps {
  db: SeedDb;
  /** The `<sha8>` of the stripped master of one source image. */
  sha8: (source: string) => Promise<string>;
  /** Throws `refusing: production database`; defaults to the one production guard. */
  guard?: (options: { dbUrl: string | undefined }) => Promise<void>;
}

export interface SeedCounts {
  markets: number;
  regions: number;
  properties: number;
  stories: number;
}

function buildRows(keyOf: KeyOf, mode: SeedArgs["mode"]) {
  const full = mode === "full";
  return {
    markets: markets.map((market, index) => marketToRows(market, keyOf, index)),
    properties: full ? properties.map((property) => propertyToRows(property, keyOf)) : [],
    stories: full ? stories.map((story) => storyToRow(story, keyOf)) : [],
  };
}

/** The keys come from the stripped masters, so they are the same with `--images skip` and `--images upload`. */
async function mediaKeys(sha8: SeedDeps["sha8"], mode: SeedArgs["mode"]): Promise<KeyOf> {
  const sources = new Set<string>();
  buildRows((source) => {
    sources.add(source);
    return source;
  }, mode);
  const hashes = new Map(
    await Promise.all([...sources].map(async (source) => [source, await sha8(source)] as const)),
  );
  return (source, owner, n) => {
    const hash = hashes.get(source);
    if (hash === undefined) throw new Error(`seed: no hash for ${source}`);
    return variantKeys(owner, n, hash).master;
  };
}

async function upsertAll(
  db: SeedDb,
  table: string,
  rows: readonly Written[],
  options: UpsertOptions,
): Promise<void> {
  if (rows.length > 0) await db.upsert(table, rows, options);
}

export async function runSeed(
  args: SeedArgs,
  { db, sha8, guard = (options) => assertNotProduction(options) }: SeedDeps,
): Promise<SeedCounts> {
  // STUB(B2 step 13): the upload mode waits for the media-store of B9 and then writes `variants` too.
  if (args.images === "upload")
    throw new Error("seed: --images upload needs the media-store of B9");
  if (args.mode === "full") await guard({ dbUrl: process.env["DEV_DB_URL"] });
  const rows = buildRows(await mediaKeys(sha8, args.mode), args.mode);

  // Reference rows are inserted only when missing: a rerun never puts back a `coming_soon` an editor turned off.
  const missing = (onConflict: string) => ({ onConflict, ignoreDuplicates: true as const });
  await upsertAll(
    db,
    "markets",
    rows.markets.map((entry) => entry.market),
    missing("slug"),
  );
  await upsertAll(
    db,
    "regions",
    rows.markets.flatMap((entry) => entry.regions),
    missing("slug"),
  );
  await upsertAll(
    db,
    "market_notes",
    rows.markets.flatMap((entry) => entry.notes),
    missing("id"),
  );
  await upsertAll(
    db,
    "market_guide_entries",
    rows.markets.flatMap((entry) => entry.guide),
    missing("id"),
  );

  if (args.mode === "full") {
    const byId = { onConflict: "id" };
    await upsertAll(
      db,
      "representatives",
      rows.properties.flatMap((entry) => entry.representative ?? []),
      byId,
    );
    await upsertAll(
      db,
      "properties",
      rows.properties.map((entry) => entry.property),
      byId,
    );
    await upsertAll(
      db,
      "property_media",
      rows.properties.flatMap((entry) => entry.media),
      byId,
    );
    await upsertAll(
      db,
      "property_features",
      rows.properties.flatMap((entry) => entry.features),
      {
        onConflict: "property_id,feature",
      },
    );
    await upsertAll(
      db,
      "property_related",
      rows.properties.flatMap((entry) => entry.related),
      {
        onConflict: "property_id,related_slug",
      },
    );
    // A published property needs its hero image, which the media trigger sets; so it is made public after its media,
    // and the editorial order allows only draft, review, published.
    for (const property of properties) {
      const slug = property.slug;
      await db.update(
        "properties",
        { editorial_state: "review" },
        { slug, editorial_state: "draft" },
      );
      await db.update(
        "properties",
        { editorial_state: "published", published_at: publicationTime(property.publishedAt) },
        { slug, editorial_state: "review" },
      );
    }
    await upsertAll(db, "stories", rows.stories, { onConflict: "slug" });
    for (const market of markets)
      await db.update("markets", { coming_soon: false }, { slug: market.slug });
  }

  return {
    markets: rows.markets.length,
    regions: rows.markets.reduce((total, entry) => total + entry.regions.length, 0),
    properties: rows.properties.length,
    stories: rows.stories.length,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
 * The client is built from this script's own names and never from SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, which a
 * shell may hold for another project: the guard and the lock are on DEV_DB_URL, so the writes must go to the same one.
 */
function supabaseDb(target: SeedArgs["target"]): SeedDb {
  const [url, key] =
    target === "local"
      ? [localApiUrl(process.env["API_URL"]), requiredEnv("SERVICE_ROLE_KEY")]
      : [
          `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
          requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
        ];
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async upsert(table, rows, options) {
      const { error } = await client.from(table).upsert([...rows], options);
      if (error !== null) throw new Error(`seed: ${table} upsert failed: ${error.message}`);
    },
    async update(table, values, where) {
      const query = client.from(table).update(values);
      const { error } = await Object.entries(where).reduce(
        (chain, [column, value]) => chain.eq(column, value),
        query,
      );
      if (error !== null) throw new Error(`seed: ${table} update failed: ${error.message}`);
    },
  };
}

/** Bundled images are JPEG; `source` is the absolute path the asset loader gives an import. */
async function masterSha8(source: string): Promise<string> {
  return sha8Of(await stripExif(await readFile(source), "image/jpeg"));
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  guardEnv();
  const db = supabaseDb(args.target);
  const release = args.target === "dev" ? await holdDevLock() : () => Promise.resolve();
  try {
    const counts = await runSeed(args, { db, sha8: masterSha8 });
    console.log(
      `markets ${String(counts.markets)}, regions ${String(counts.regions)}, properties ${String(counts.properties)}, stories ${String(counts.stories)}`,
    );
  } finally {
    await release();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
