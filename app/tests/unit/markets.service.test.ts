import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketUpdateInputSchema } from "../../src/domain/admin-markets";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import {
  getMarket,
  listMarkets,
  setComingSoon,
  updateMarket,
} from "../../src/server/markets/service";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// Screen 15 (B7 step 13): one database call per write after `authorize`; a visual editor reads and never edits
// (S26). The SQL behind each RPC is in tests/db/admin.db.test.ts and admin-cache.db.test.ts.

const UPDATED = "2026-10-08T12:00:00.123456+00:00";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const MARKET_PATH = "staging/market/california/00000000-0000-4000-8000-0000000000c1.jpg";
const REGION_PATH = "staging/region/bay-area/00000000-0000-4000-8000-0000000000c2.jpg";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-markets",
});

const visual = actor(["visual_editor"]);
const managing = actor(["managing_editor"]);
const audit = { p_actor: managing.userId, p_actor_kind: "human", p_request_id: "req-markets" };

const marketRow = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  name: slug,
  intro: "An intro.",
  places: ["One"],
  image: null,
  sort_order: 0,
  coming_soon: true,
  interest_copy: null,
  updated_at: UPDATED,
  ...over,
});

const bayArea = {
  slug: "bay-area",
  name: "Bay Area",
  intro: "The bay.",
  places: ["Marin"],
  sort_order: 0,
};

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

/** A Storage client that signs every read and records each removal. */
function storage(removed: string[] = []) {
  return {
    submissions: {
      createSignedUrl: (path: unknown) => ({
        data: { signedUrl: `https://storage.test/read/${String(path)}` },
        error: null,
      }),
      remove: (paths: unknown) => {
        if (Array.isArray(paths)) removed.push(...paths.map(String));
        return { data: [], error: null };
      },
    },
  };
}

const serveBytes = (bytes: Uint8Array<ArrayBuffer>) => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes, { status: 206 })));
};

const calls = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

const saved = () => ({ slug: "california", updated_at: UPDATED });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMarkets", () => {
  it("lists the markets in site order with their interest signups split into confirmed and pending, and none for a market nobody wrote to", async () => {
    const db = withTables(fakeDb(), {
      markets: [
        marketRow("florida", { sort_order: 2 }),
        marketRow("california", { sort_order: 0, image: "m/ca-0a1b2c3d.webp" }),
        marketRow("new-york", { sort_order: 1, coming_soon: false }),
      ],
      market_interest_counts: [
        { market_slug: "california", total: 5, confirmed: 3, pending: 2 },
        { market_slug: "florida", total: 1, confirmed: 0, pending: 1 },
      ],
    });
    const answer = await listMarkets(visual, db);
    expect(
      answer.items.map((row) => [row.slug, row.coming_soon, row.image_url, row.interest]),
    ).toEqual([
      ["california", true, "/media/m/ca-0a1b2c3d.webp", { confirmed: 3, pending: 2 }],
      ["new-york", false, null, { confirmed: 0, pending: 0 }],
      ["florida", true, null, { confirmed: 0, pending: 1 }],
    ]);
  });
});

describe("getMarket", () => {
  it("answers the market with its regions, notes and guide entries in stored order and the address of each image, and 404 for a market with no row", async () => {
    const tables = {
      markets: [marketRow("california", { image: "m/ca-0a1b2c3d.webp" })],
      regions: [
        {
          ...bayArea,
          market_slug: "california",
          slug: "los-angeles",
          name: "Los Angeles",
          sort_order: 1,
          image: null,
        },
        { ...bayArea, market_slug: "california", image: "r/bay-0a1b2c3d.webp" },
      ],
      market_notes: [
        { id: "2", market_slug: "california", label: "Water", text: "t", sort_order: 1 },
        { id: "1", market_slug: "california", label: "Light", text: "t", sort_order: 0 },
      ],
      market_guide_entries: [
        {
          id: "1",
          market_slug: "california",
          section: "need",
          region_slug: null,
          label: "Parking",
          text: "t",
          sort_order: 0,
        },
        {
          id: "2",
          market_slug: "california",
          section: "neighborhood",
          region_slug: "bay-area",
          label: "Marin",
          text: "t",
          sort_order: 1,
        },
      ],
      market_interest_counts: [{ market_slug: "california", total: 2, confirmed: 2, pending: 0 }],
    };
    const found = await getMarket(visual, withTables(fakeDb(), tables), "california");
    const missing = await outcome(
      getMarket(visual, withTables(fakeDb(), { ...tables, markets: [] }), "california"),
    );
    expect({
      image_url: found.image_url,
      regions: found.regions.map((region) => [region.slug, region.image_url]),
      notes: found.notes.map((note) => note.label),
      guide: found.guide_entries.map((entry) => entry.label),
      interest: found.interest,
      missing,
    }).toEqual({
      image_url: "/media/m/ca-0a1b2c3d.webp",
      regions: [
        ["bay-area", "/media/r/bay-0a1b2c3d.webp"],
        ["los-angeles", null],
      ],
      notes: ["Light", "Water"],
      guide: ["Parking", "Marin"],
      interest: { confirmed: 2, pending: 0 },
      missing: { status: 404, code: "not_found" },
    });
  });
});

describe("updateMarket", () => {
  it("makes one update_market call with the patch, the regions as sent, the notes and guide entries, and null for a part the editor left out", async () => {
    const db = fakeDb({ rpc: { update_market: saved } });
    const full = await updateMarket(
      managing,
      db,
      marketUpdateInputSchema.parse({
        slug: "california",
        patch: { intro: "A new intro." },
        regions: [bayArea],
        notes: [{ label: "Light", text: "t" }],
        guide_entries: [{ section: "need", region_slug: null, label: "Parking", text: "t" }],
      }),
    );
    const bare = fakeDb({ rpc: { update_market: saved } });
    await updateMarket(managing, bare, marketUpdateInputSchema.parse({ slug: "california" }));
    expect({ full, calls: db.calls, bare: bare.calls[0]?.args }).toEqual({
      full: saved(),
      calls: [
        {
          kind: "rpc",
          name: "update_market",
          args: [
            {
              p_slug: "california",
              p_patch: { intro: "A new intro." },
              p_regions: [bayArea],
              p_notes: [{ label: "Light", text: "t" }],
              p_guide_entries: [
                { section: "need", region_slug: null, label: "Parking", text: "t" },
              ],
              ...audit,
            },
          ],
        },
      ],
      bare: [
        {
          p_slug: "california",
          p_patch: {},
          p_regions: null,
          p_notes: null,
          p_guide_entries: null,
          ...audit,
        },
      ],
    });
  });

  it("keeps an existing region image on save: the region goes to update_market with no image key, and the input schema refuses one", async () => {
    const db = fakeDb({ rpc: { update_market: saved } });
    await updateMarket(
      managing,
      db,
      marketUpdateInputSchema.parse({ slug: "california", regions: [bayArea] }),
    );
    const sent = db.calls[0]?.args[0];
    expect({
      sent: JSON.stringify(sent).includes('"image"'),
      refused: marketUpdateInputSchema.safeParse({
        slug: "california",
        regions: [{ ...bayArea, image: "r/other.webp" }],
      }).success,
    }).toEqual({ sent: false, refused: false });
  });

  it("reads the first bytes of a staged market image and of a staged region image, then makes the one update_market call carrying both paths", async () => {
    serveBytes(JPEG);
    const db = fakeDb({ storage: storage(), rpc: { update_market: saved } });
    await updateMarket(
      managing,
      db,
      marketUpdateInputSchema.parse({
        slug: "california",
        image_staging_path: MARKET_PATH,
        regions: [{ ...bayArea, image_staging_path: REGION_PATH }],
      }),
    );
    expect({ calls: calls(db), args: db.calls.at(-1)?.args }).toEqual({
      calls: [
        "storage:submissions.createSignedUrl",
        "storage:submissions.createSignedUrl",
        "rpc:update_market",
      ],
      args: [
        expect.objectContaining({
          p_image_staging_path: MARKET_PATH,
          p_regions: [{ ...bayArea, image_staging_path: REGION_PATH }],
        }),
      ],
    });
  });

  it("removes a staged region file that is not a photograph, answers 422 invalid_image and makes no update_market call", async () => {
    serveBytes(new TextEncoder().encode("<html>not an image</html>"));
    const removed: string[] = [];
    const db = fakeDb({ storage: storage(removed) });
    const answer = await outcome(
      updateMarket(
        managing,
        db,
        marketUpdateInputSchema.parse({
          slug: "california",
          regions: [{ ...bayArea, image_staging_path: REGION_PATH }],
        }),
      ),
    );
    expect({ answer, removed, calls: calls(db) }).toEqual({
      answer: { status: 422, code: "invalid_image" },
      removed: [REGION_PATH],
      calls: ["storage:submissions.createSignedUrl", "storage:submissions.remove"],
    });
  });

  it("answers 422 invalid_image for a path outside the market's and the region's own folder, with no Storage call and no update_market call", async () => {
    const db = fakeDb({ storage: storage() });
    const answers = [
      await outcome(
        updateMarket(
          managing,
          db,
          marketUpdateInputSchema.parse({
            slug: "california",
            image_staging_path: "staging/market/florida/x.jpg",
          }),
        ),
      ),
      await outcome(
        updateMarket(
          managing,
          db,
          marketUpdateInputSchema.parse({
            slug: "california",
            regions: [{ ...bayArea, image_staging_path: "staging/region/miami/x.jpg" }],
          }),
        ),
      ),
    ];
    expect({ answers, calls: db.calls }).toEqual({
      answers: [
        { status: 422, code: "invalid_image" },
        { status: 422, code: "invalid_image" },
      ],
      calls: [],
    });
  });

  it("maps the database's invalid_key and not_found to 422 and 404", async () => {
    const refusing = fakeDb({ rpc: { update_market: () => new Error("invalid_key") } });
    const unknown = fakeDb({
      rpc: { update_market: () => Object.assign(new Error("not_found"), { code: "P0002" }) },
    });
    const input = marketUpdateInputSchema.parse({ slug: "california" });
    expect([
      await outcome(updateMarket(managing, refusing, input)),
      await outcome(updateMarket(managing, unknown, input)),
    ]).toEqual([
      { status: 422, code: "invalid_key" },
      { status: 404, code: "not_found" },
    ]);
  });

  it("a visual editor and commercial get 403 on an edit and on the toggle, with no database call", async () => {
    const db = fakeDb();
    const input = marketUpdateInputSchema.parse({ slug: "california" });
    expect({
      answers: [
        await outcome(updateMarket(visual, db, input)),
        await outcome(updateMarket(actor(["commercial"]), db, input)),
        await outcome(setComingSoon(visual, db, { slug: "california", coming_soon: false })),
      ],
      calls: db.calls,
    }).toEqual({
      answers: [
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
      ],
      calls: [],
    });
  });
});

describe("setComingSoon", () => {
  const input = { slug: "california", coming_soon: false } as const;
  const answer = { ...saved(), coming_soon: false };

  it("passes p_notify false with a registry that has no market_open_notice module and true with one that returns it, each with the actor's audit context", async () => {
    const without = fakeDb({ rpc: { set_market_coming_soon: () => answer } });
    const withModule = fakeDb({ rpc: { set_market_coming_soon: () => answer } });
    await setComingSoon(managing, without, input, () => undefined);
    await setComingSoon(managing, withModule, input, (type) =>
      type === "market_open_notice" ? { type } : undefined,
    );
    const call = (notify: boolean) => ({
      kind: "rpc",
      name: "set_market_coming_soon",
      args: [{ p_slug: "california", p_coming_soon: false, p_notify: notify, ...audit }],
    });
    expect({ without: without.calls, withModule: withModule.calls }).toEqual({
      without: [call(false)],
      withModule: [call(true)],
    });
  });

  it("passes p_notify true with the real registries, because B11 registered market_open_notice as a system job", async () => {
    const db = fakeDb({ rpc: { set_market_coming_soon: () => answer } });
    await setComingSoon(managing, db, input);
    expect(db.calls[0]?.args).toEqual([expect.objectContaining({ p_notify: true })]);
  });

  it("answers the market's state, and closing a market sends the same call", async () => {
    const db = fakeDb({
      rpc: { set_market_coming_soon: () => ({ ...answer, coming_soon: true }) },
    });
    const closed = await setComingSoon(
      managing,
      db,
      { slug: "california", coming_soon: true },
      () => undefined,
    );
    expect({ closed, args: db.calls[0]?.args }).toEqual({
      closed: { ...answer, coming_soon: true },
      args: [{ p_slug: "california", p_coming_soon: true, p_notify: false, ...audit }],
    });
  });
});

describe("the market routes input", () => {
  it("refuses image, coming_soon and unknown keys in the patch, a region image, and a neighborhood without a region at the door", () => {
    const parse = (body: Record<string, unknown>) =>
      marketUpdateInputSchema.safeParse({ slug: "california", ...body }).success;
    expect({
      image: parse({ patch: { image: "m/a.webp" } }),
      comingSoon: parse({ patch: { coming_soon: false } }),
      name: parse({ patch: { name: "California" } }),
      neighborhood: parse({
        guide_entries: [{ section: "neighborhood", region_slug: null, label: "a", text: "b" }],
      }),
      service: parse({
        guide_entries: [{ section: "service", region_slug: null, label: "a", text: "b" }],
      }),
      twice: parse({ regions: [bayArea, bayArea] }),
    }).toEqual({
      image: false,
      comingSoon: false,
      name: true,
      neighborhood: false,
      service: true,
      twice: false,
    });
  });
});
