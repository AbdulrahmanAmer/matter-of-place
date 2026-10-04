import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogDb } from "../fixtures/snapshot";

// The token index is built by the first search of a catalog version, never by the catalog read (PERF-03 (3)).
vi.mock("../../src/server/search/token-index", { spy: true });

/** A fresh module graph per test: the catalog memo and the index memo live in module state. */
async function load() {
  vi.resetModules();
  return {
    state: await import("../../src/server/public/state"),
    search: await import("../../src/server/search/service"),
    tokens: await import("../../src/server/search/token-index"),
  };
}

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the search index", () => {
  it("lazy_index: getCatalog never builds it, the first search of a version builds it once, the second reuses it", async () => {
    const { state, search, tokens } = await load();
    const db = catalogDb(7);
    await state.getCatalog(db);
    await state.getCatalog(db);
    expect(tokens.buildTokenIndex).not.toHaveBeenCalled();
    await search.match(db, { text: "cliff", limit: 6 });
    expect(tokens.buildTokenIndex).toHaveBeenCalledTimes(1);
    await search.match(db, { text: "tiburon", limit: 6 });
    expect(tokens.buildTokenIndex).toHaveBeenCalledTimes(1);
  });

  it("builds the index again for the next catalog version, and not again for the same one", async () => {
    const { search, tokens } = await load();
    await search.match(catalogDb(7), { text: "cliff", limit: 6 });
    await search.match(catalogDb(7), { text: "cliff", limit: 6 });
    expect(tokens.buildTokenIndex).toHaveBeenCalledTimes(1);
    await search.match(catalogDb(8), { text: "cliff", limit: 6 });
    expect(tokens.buildTokenIndex).toHaveBeenCalledTimes(2);
  });
});
