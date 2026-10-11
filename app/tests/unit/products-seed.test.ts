import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offerings } from "../../src/data/exposure";
import { plansFromOfferings, productsSettingSchema } from "../../src/domain/exposure";
import { productsOf, seedProducts } from "../../src/server/settings/products";

const MIGRATIONS = "supabase/migrations";

function migrationText(): string {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith("_settings_products.sql"));
  expect(files).toHaveLength(1);
  return readFileSync(`${MIGRATIONS}/${files[0] ?? ""}`, "utf8");
}

/** The JSON literal of the seed insert, as the migration spells it. */
function seededLiteral(): unknown {
  const found =
    /values\s*\(\s*'products',\s*'([^']*)'::jsonb\s*\)\s*on conflict \(key\) do nothing/.exec(
      migrationText(),
    );
  expect(found).not.toBeNull();
  return JSON.parse(found?.[1] ?? "null");
}

const logged: string[] = [];

beforeEach(() => {
  logged.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seed of settings.products", () => {
  it("is the four offerings with their prices in whole dollars", () => {
    expect(seedProducts()).toEqual(plansFromOfferings(offerings));
    expect(seedProducts().map((plan) => [plan.id, plan.price])).toEqual([
      ["feature", 295],
      ["reach", 695],
      ["campaign", 1495],
      ["five-features", 1250],
    ]);
  });

  it("passes the schema that validates a save", () => {
    expect(productsSettingSchema.parse({ plans: seedProducts() })).toEqual({
      plans: seedProducts(),
    });
  });

  it("is the literal the migration inserts, field for field", () => {
    expect(seededLiteral()).toEqual({ plans: plansFromOfferings(offerings) });
  });

  it("is inserted once and never overwritten, and the triggers name the key", () => {
    const text = migrationText();
    expect(text.match(/on conflict \(key\) do nothing/g)).toHaveLength(1);
    expect(text.match(/'og_static', 'products'\)\)/g)).toHaveLength(2);
  });
});

describe("productsOf", () => {
  it("reads a stored value that parses", () => {
    const stored = { plans: seedProducts().map((plan) => ({ ...plan, price: plan.price + 5 })) };
    expect(productsOf({ products: stored })).toEqual(stored.plans);
    expect(logged).toEqual([]);
  });

  it("serves the seed without a word when the row is missing", () => {
    expect(productsOf({ products: null })).toEqual(seedProducts());
    expect(logged).toEqual([]);
  });

  it("serves the seed with one products_invalid line when the stored value does not parse", () => {
    const broken = { plans: seedProducts().slice(0, 3) };
    expect(productsOf({ products: broken })).toEqual(seedProducts());
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"event":"products_invalid"');
    expect(logged[0]).toContain("adding or removing a plan needs a migration");
  });
});
