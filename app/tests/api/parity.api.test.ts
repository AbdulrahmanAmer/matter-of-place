// The live catalog answers (`/properties`, `/markets`, `/stories`) against the bundled data the local adapter serves
// (step 4): the same records, field for field, once every image address is reduced to the name of its source file.
// This is the evidence that the frontend needs no change when `services.mode` turns live.
//
// Three things differ by design and are named here, not hidden: the database makes `id` a uuid where the bundled data
// has "mop-001" (no component reads it), the snapshot carries neither `campaignTier` nor `source` (G-303), and the list
// of properties comes newest first (the snapshot's `published_at desc`) where the bundled array is in authoring order.
import "./env";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { stripExif } from "../../scripts/lib/strip-exif";
import { sha8Of } from "../../scripts/variants";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import { handlePublic } from "../../src/server/public/pipeline";

type Fields = Record<string, unknown>;

const ASSETS = resolve(import.meta.dirname, "../../src/assets");
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const records = z.array(z.record(z.string(), z.unknown()));

/** Every bundled photograph by the `<sha8>` of its stripped master, the digest the stored key carries. */
async function assetNames(directory: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jpg")) continue;
    const path = resolve(entry.parentPath, entry.name);
    const hash = sha8Of(await stripExif(readFileSync(path), "image/jpeg"));
    names.set(hash, relative(ASSETS, path).split(sep).join("/"));
  }
  return names;
}

let byHash = new Map<string, string>();

beforeAll(async () => {
  process.env["CATALOG_VERSION_TTL_MS"] = "0";
  byHash = await assetNames(ASSETS);
}, 60_000);

/** `/media/o/<owner>/<n>-<sha8>.webp` and the `/media/v/...` renditions name the photograph by the digest in the key. */
const isStoredImage = (value: string) => /^\/media\/[ov]\//.test(value);

function fromKey(address: string): string {
  const hash = /-([0-9a-f]{8})[./]/.exec(address)?.[1];
  const name = hash === undefined ? undefined : byHash.get(hash);
  return name === undefined ? `unknown:${address}` : name;
}

/** A bundled import: Vite gives `/src/assets/<name>` in a test. */
const isImport = (value: string) => value.includes("/src/assets/");
const fromImport = (address: string) => address.replace(/^.*\/src\/assets\//, "");

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every address string becomes the asset's name; every other value stays as it is. */
function named(
  value: unknown,
  isAddress: (text: string) => boolean,
  rename: (text: string) => string,
): unknown {
  if (typeof value === "string") return isAddress(value) ? rename(value) : value;
  if (Array.isArray(value)) return value.map((item) => named(item, isAddress, rename));
  if (isFields(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, named(item, isAddress, rename)]),
    );
  }
  return value;
}

function show(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value).slice(0, 80);
}

/** The path of every leaf that differs, so a failure names the record and the field a mapper dropped or changed. */
function differences(path: string, left: unknown, right: unknown): string[] {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) =>
      differences(`${path}[${String(index)}]`, left[index], right[index]),
    ).flat();
  }
  if (isFields(left) && isFields(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].flatMap((key) => differences(`${path}.${key}`, left[key], right[key]));
  }
  return Object.is(left, right) ? [] : [`${path}: bundled ${show(left)}, live ${show(right)}`];
}

async function live(path: string): Promise<Fields[]> {
  const response = await handlePublic(
    new Request(`http://localhost/api/public${path}`),
    "req-api-parity-0001",
  );
  expect(response.status).toBe(200);
  return records.parse(await response.json());
}

/** The records by slug, without the fields that differ by design, each image address as the name of its file. */
function bySlug(items: readonly Fields[], omit: readonly string[], side: "bundled" | "live") {
  const [isAddress, rename] =
    side === "bundled" ? [isImport, fromImport] : [isStoredImage, fromKey];
  return Object.fromEntries(
    items.map((item) => {
      const kept = Object.fromEntries(Object.entries(item).filter(([key]) => !omit.includes(key)));
      return [String(item["slug"]), named(kept, isAddress, rename)];
    }),
  );
}

/** The bundled records are plain data: the same fields the JSON holds. */
const asFields = (items: readonly object[]): Fields[] => records.parse(items);

describe("the live catalog and the bundled data", () => {
  it("answers /properties with the bundled properties and no difference", async () => {
    const answer = await live("/properties");
    expect(
      differences(
        "properties",
        bySlug(asFields(properties), ["id", "campaignTier", "source"], "bundled"),
        bySlug(answer, ["id"], "live"),
      ),
    ).toEqual([]);
    expect(answer.every((item) => UUID.test(String(item["id"])))).toBe(true);
    const dates = answer.map((item) => String(item["publishedAt"]));
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("answers /markets with the bundled markets and no difference", async () => {
    const answer = await live("/markets");
    expect(
      differences("markets", bySlug(asFields(markets), [], "bundled"), bySlug(answer, [], "live")),
    ).toEqual([]);
  });

  it("answers /stories with the bundled stories and no difference", async () => {
    const answer = await live("/stories");
    expect(
      differences(
        "stories",
        bySlug(asFields(stories), ["id"], "bundled"),
        bySlug(answer, ["id"], "live"),
      ),
    ).toEqual([]);
    expect(answer.every((item) => UUID.test(String(item["id"])))).toBe(true);
  });
});
